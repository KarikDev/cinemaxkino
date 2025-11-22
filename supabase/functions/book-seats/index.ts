import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BookingRequest {
  seats: Array<{
    row_label: string;
    seat_number: number;
    name: string;
  }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const webhookUrl = Deno.env.get('WEBHOOK_URL');

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { seats }: BookingRequest = await req.json();

    console.log('Booking request received:', seats);

    // Update seats in database
    for (const seat of seats) {
      const { error } = await supabase
        .from('seats')
        .update({ 
          is_taken: true, 
          booked_by: seat.name 
        })
        .eq('row_label', seat.row_label)
        .eq('seat_number', seat.seat_number);

      if (error) {
        console.error('Error booking seat:', error);
        throw error;
      }
    }

    // Send webhook notification
    if (webhookUrl) {
      const webhookPayload = {
        event: 'seats_booked',
        timestamp: new Date().toISOString(),
        seats: seats.map(s => ({
          seat: `${s.row_label}${s.seat_number}`,
          name: s.name
        }))
      };

      console.log('Sending webhook:', webhookPayload);

      const webhookResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(webhookPayload),
      });

      console.log('Webhook response status:', webhookResponse.status);
    }

    return new Response(
      JSON.stringify({ success: true, booked_seats: seats.length }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );
  } catch (error) {
    console.error('Error in book-seats function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});