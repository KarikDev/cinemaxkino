import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import clsx from "clsx";

interface Seat {
  id: string;
  row_label: string;
  seat_number: number;
  is_taken: boolean;
  booked_by: string | null;
}

const Index = () => {
  const [seats, setSeats] = useState<Seat[]>([]);
  const [selectedSeats, setSelectedSeats] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [isBooking, setIsBooking] = useState(false);
  const [justBookedSeats, setJustBookedSeats] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    fetchSeats();

    const channel = supabase
      .channel("seats-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seats" },
        (payload: any) => {
          setSeats((prevSeats) => {
            const seatMap = new Map(prevSeats.map((s) => [s.id, s]));

            switch (payload.eventType) {
              case "INSERT":
              case "UPDATE":
                seatMap.set(payload.new!.id, payload.new!);
                break;
              case "DELETE":
                seatMap.delete(payload.old!.id);
                break;
            }

            return Array.from(seatMap.values()).sort(
              (a, b) =>
                a.row_label.localeCompare(b.row_label) ||
                a.seat_number - b.seat_number
            );
          });

          // Pulse effect for newly booked seats
          if (
            payload.eventType === "UPDATE" &&
            payload.new!.is_taken &&
            !selectedSeats.has(payload.new!.id)
          ) {
            setJustBookedSeats((prev) => {
              const updated = new Set(prev);
              updated.add(payload.new!.id);

              setTimeout(() => {
                setJustBookedSeats((cur) => {
                  const next = new Set(cur);
                  next.delete(payload.new!.id);
                  return next;
                });
              }, 1000);

              return updated;
            });
          }

          // Auto-deselect if selected seat is booked by someone else
          if (
            payload.eventType === "UPDATE" &&
            selectedSeats.has(payload.new!.id) &&
            payload.new!.is_taken
          ) {
            setSelectedSeats((prev) => {
              const updated = new Set(prev);
              updated.delete(payload.new!.id);
              return updated;
            });

            setNames((prev) => {
              const updatedNames = { ...prev };
              delete updatedNames[payload.new!.id];
              return updatedNames;
            });

            toast({
              title: "Miesto obsadené",
              description: `Miesto ${payload.new!.row_label}${payload.new!.seat_number} bolo práve rezervované iným užívateľom.`,
              variant: "destructive",
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedSeats, toast]);

  const fetchSeats = async () => {
    const { data, error } = await supabase
      .from("seats")
      .select("*")
      .order("row_label")
      .order("seat_number");

    if (error) {
      console.error("Error fetching seats:", error);
      return;
    }

    setSeats(data || []);
  };

  const toggleSeatSelection = (seatId: string) => {
    const newSelected = new Set(selectedSeats);

    if (newSelected.has(seatId)) {
      newSelected.delete(seatId);
      const newNames = { ...names };
      delete newNames[seatId];
      setNames(newNames);
    } else {
      newSelected.add(seatId);
    }

    setSelectedSeats(newSelected);
  };

  const handleNameChange = (seatId: string, name: string) => {
    setNames({ ...names, [seatId]: name });
  };

  const handleBooking = async () => {
    const allNamesFilled = Array.from(selectedSeats).every(
      (seatId) => names[seatId]?.trim()
    );

    if (!allNamesFilled) {
      toast({
        title: "Chyba",
        description: "Prosím vyplňte mená pre všetky vybrané miesta",
        variant: "destructive",
      });
      return;
    }

    setIsBooking(true);

    try {
      const bookingData = Array.from(selectedSeats).map((seatId) => {
        const seat = seats.find((s) => s.id === seatId)!;
        return {
          seat_number: seat.seat_number,
          seat_row: seat.row_label,
          name: names[seatId],
        };
      });

      // 1️⃣ Book seats in Supabase
      const { error } = await supabase.functions.invoke("book-seats", {
        body: JSON.stringify({ seats: bookingData }),
      });

      if (error) throw error;

      // 2️⃣ Send each booked seat to Home Assistant webhook
      for (const seat of bookingData) {
        await fetch(
          "https://homeassistant.3dprintsskalica.eu/api/webhook/-4t9pUd0GLPurXU0a6qvB1qEx",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              item: `${seat.seat_number} ${seat.seat_row} ${seat.name}`,
            }),
          }
        );
      }

      toast({
        title: "Úspech!",
        description: `Zarezervovali ste ${selectedSeats.size} ${
          selectedSeats.size === 1 ? "miesto" : "miest"
        }`,
      });

      setSelectedSeats(new Set());
      setNames({});
      fetchSeats();
    } catch (error: any) {
      console.error("Booking error:", error);
      toast({
        title: "Chyba",
        description: `Nepodarilo sa zarezervovať miesta: ${error?.message || error}`,
        variant: "destructive",
      });
    } finally {
      setIsBooking(false);
    }
  };

  const getSeatColor = (seat: Seat) => {
    if (seat.is_taken)
      return "bg-destructive hover:bg-destructive cursor-not-allowed";
    if (selectedSeats.has(seat.id)) return "bg-primary hover:bg-primary/90";
    return "bg-muted hover:bg-muted/80";
  };

  const rows = Array.from(new Set(seats.map((s) => s.row_label))).sort();

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold mb-2 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Vitajte v kinovom vybierači miest!
          </h1>
          <p className="text-lg text-muted-foreground">vyberte si miesta:</p>
        </div>

        {/* Legend */}
        <div className="flex justify-center gap-6 mb-8 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-muted rounded"></div>
            <span className="text-sm">Voľné</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded"></div>
            <span className="text-sm">Vaše výber</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-destructive rounded"></div>
            <span className="text-sm">Obsadené</span>
          </div>
        </div>

        {/* Cinema Screen */}
        <div className="mb-8">
          <div className="h-3 bg-gradient-to-b from-primary/20 to-transparent rounded-t-3xl mx-auto max-w-4xl"></div>
          <div className="text-center text-sm text-muted-foreground">PLÁTNO</div>
        </div>

        {/* Seats Grid */}
        <div className="space-y-4 mb-8">
          {rows.map((row) => {
            const rowSeats = seats.filter((s) => s.row_label === row);
            const hasExtendedSeats = rowSeats.some((s) => s.seat_number > 19);

            return (
              <div key={row} className="flex items-center justify-center gap-2">
                <span className="w-8 text-center font-semibold text-muted-foreground">
                  {row}
                </span>
                <div className="flex gap-2 justify-center overflow-x-auto whitespace-nowrap">
                  {/* Seats 1-19 */}
                  <div className="flex gap-2">
                    {rowSeats
                      .filter((s) => s.seat_number <= 19)
                      .map((seat) => (
                        <button
                          key={seat.id}
                          onClick={() =>
                            !seat.is_taken && toggleSeatSelection(seat.id)
                          }
                          disabled={seat.is_taken}
                          className={clsx(
                            "w-10 h-10 rounded-lg transition-all text-xs font-medium text-primary-foreground flex items-center justify-center",
                            getSeatColor(seat),
                            justBookedSeats.has(seat.id) && "animate-pulse"
                          )}
                          title={
                            seat.is_taken
                              ? `Obsadené: ${seat.booked_by}`
                              : `${row}${seat.seat_number}`
                          }
                        >
                          {seat.seat_number}
                        </button>
                      ))}
                  </div>

                  {/* Extra seats 20+ */}
                  {hasExtendedSeats && (
                    <div className="flex gap-2 ml-8">
                      {rowSeats
                        .filter((s) => s.seat_number > 19)
                        .map((seat) => (
                          <button
                            key={seat.id}
                            onClick={() =>
                              !seat.is_taken && toggleSeatSelection(seat.id)
                            }
                            disabled={seat.is_taken}
                            className={clsx(
                              "w-10 h-10 rounded-lg transition-all text-xs font-medium text-primary-foreground flex items-center justify-center",
                              getSeatColor(seat),
                              justBookedSeats.has(seat.id) && "animate-pulse"
                            )}
                            title={
                              seat.is_taken
                                ? `Obsadené: ${seat.booked_by}`
                                : `${row}${seat.seat_number}`
                            }
                          >
                            {seat.seat_number}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Name Inputs */}
        {selectedSeats.size > 0 && (
          <div className="bg-card border rounded-lg p-6 mb-6 shadow-lg">
            <h2 className="text-xl font-semibold mb-4">
              Zadajte mená pre vybrané miesta:
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from(selectedSeats).map((seatId) => {
                const seat = seats.find((s) => s.id === seatId);
                return (
                  <div key={seatId} className="space-y-2">
                    <label className="text-sm font-medium">
                      Miesto {seat?.row_label} {seat?.seat_number}:
                    </label>
                    <Input
                      placeholder="Meno"
                      value={names[seatId] || ""}
                      onChange={(e) => handleNameChange(seatId, e.target.value)}
                      required
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Booking Button */}
        {selectedSeats.size > 0 && (
          <div className="flex justify-center">
            <Button
              size="lg"
              onClick={handleBooking}
              disabled={isBooking}
              className="text-lg px-8 py-6"
            >
              {isBooking
                ? "Rezervujem..."
                : `chccem tieto miesta (${selectedSeats.size})`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;

{/*TEST*/}
