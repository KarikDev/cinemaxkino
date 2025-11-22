-- Create seats table for tracking seat selections
CREATE TABLE public.seats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  row_label TEXT NOT NULL,
  seat_number INTEGER NOT NULL,
  is_taken BOOLEAN NOT NULL DEFAULT false,
  booked_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(row_label, seat_number)
);

-- Enable Row Level Security
ALTER TABLE public.seats ENABLE ROW LEVEL SECURITY;

-- Allow everyone to read seats (public viewing)
CREATE POLICY "Everyone can view seats"
  ON public.seats
  FOR SELECT
  USING (true);

-- Allow everyone to book seats (update)
CREATE POLICY "Everyone can book seats"
  ON public.seats
  FOR UPDATE
  USING (true);

-- Allow everyone to insert seats
CREATE POLICY "Everyone can insert seats"
  ON public.seats
  FOR INSERT
  WITH CHECK (true);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_seats_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_seats_updated_at
  BEFORE UPDATE ON public.seats
  FOR EACH ROW
  EXECUTE FUNCTION public.update_seats_updated_at();

-- Enable realtime for seats table
ALTER PUBLICATION supabase_realtime ADD TABLE public.seats;

-- Insert initial seats (rows A-J, seats 1-10 per row)
INSERT INTO public.seats (row_label, seat_number)
SELECT 
  chr(64 + row_num) as row_label,
  seat_num
FROM 
  generate_series(1, 10) as row_num,
  generate_series(1, 10) as seat_num;