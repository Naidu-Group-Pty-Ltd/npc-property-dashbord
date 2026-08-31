import { useMemo } from 'react';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, eachHourOfInterval, setHours, setMinutes, differenceInMinutes, getDay, getHours, addHours } from 'date-fns';
import { Sparkles, Clock, TrendingUp, Lightbulb, CheckCircle2, Calendar } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { fallsOutsideWeek, resolveRecommendedSlot } from '@/lib/calendar/recommendedSlot.pure';

interface ResourceOptimizationProps {
  events: Array<{
    startTime?: string;
    endTime?: string;
    appointmentStatus?: string;
  }>;
  currentWeek: Date;
  selectedDate?: Date | null;
  onSlotSelect?: (date: Date, hour: number) => void;
}

interface TimeSlotScore {
  day: number;
  hour: number;
  score: number;
  reasons: string[];
  historicalSuccess: number;
}

export function ResourceOptimization({ events, currentWeek, selectedDate, onSlotSelect }: ResourceOptimizationProps) {
  const safeParseISO = (value: string | undefined): Date | null => {
    try {
      if (!value) return null;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  };

  const weekStart = startOfWeek(currentWeek);
  const weekEnd = endOfWeek(currentWeek);
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  // Analyze historical patterns and calculate optimal slots
  const analysis = useMemo(() => {
    // Count events by day of week and hour
    const dayHourCounts: Record<string, { total: number; confirmed: number; noshow: number }> = {};
    
    events.forEach(event => {
      const start = safeParseISO(event.startTime);
      if (start) {
        const day = getDay(start);
        const hour = getHours(start);
        const key = `${day}-${hour}`;
        
        if (!dayHourCounts[key]) {
          dayHourCounts[key] = { total: 0, confirmed: 0, noshow: 0 };
        }
        dayHourCounts[key].total++;
        
        if (event.appointmentStatus === 'confirmed' || event.appointmentStatus === 'showed') {
          dayHourCounts[key].confirmed++;
        } else if (event.appointmentStatus === 'noshow') {
          dayHourCounts[key].noshow++;
        }
      }
    });

    // Calculate success rate for each time slot
    const slotScores: TimeSlotScore[] = [];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (let day = 0; day < 7; day++) {
      for (let hour = 8; hour < 18; hour++) { // Business hours 8 AM - 6 PM
        const key = `${day}-${hour}`;
        const data = dayHourCounts[key] || { total: 0, confirmed: 0, noshow: 0 };
        
        const reasons: string[] = [];
        let score = 50; // Base score

        // Factor 1: Historical success rate
        if (data.total > 0) {
          const successRate = (data.confirmed / data.total) * 100;
          score += (successRate - 50) * 0.3;
          if (successRate > 80) reasons.push('High success rate');
          if (data.noshow / data.total > 0.3) {
            score -= 15;
            reasons.push('High no-show rate');
          }
        }

        // Factor 2: Time of day preferences (morning meetings tend to have better attendance)
        if (hour >= 9 && hour <= 11) {
          score += 10;
          reasons.push('Morning slot - higher attendance');
        } else if (hour >= 14 && hour <= 16) {
          score += 5;
          reasons.push('Afternoon slot - good productivity');
        } else if (hour >= 17) {
          score -= 10;
          reasons.push('Late day - may conflict with personal time');
        }

        // Factor 3: Day of week
        if (day === 0 || day === 6) { // Weekend
          score -= 20;
          reasons.push('Weekend');
        } else if (day === 1) { // Monday
          score += 5;
          reasons.push('Start of week');
        } else if (day === 5) { // Friday
          score -= 5;
          reasons.push('End of week');
        }

        // Factor 4: Utilization (avoid overcrowded slots)
        if (data.total > 3) {
          score -= 10;
          reasons.push('High demand slot');
        } else if (data.total === 0) {
          score += 5;
          reasons.push('Underutilized slot');
        }

        // Availability is asked of the date this slot would actually book —
        // `weekDays[day]` is this calendar week's occurrence, which may already
        // be in the past, so it was answering for the wrong day.
        const slotTime = resolveRecommendedSlot(day, hour);
        const isOccupied = events.some(e => {
          const start = safeParseISO(e.startTime);
          const end = safeParseISO(e.endTime);
          if (!start || !end) return false;
          return slotTime >= start && slotTime < end;
        });

        if (isOccupied) {
          score = 0;
          reasons.length = 0;
          reasons.push('Already booked');
        }

        slotScores.push({
          day,
          hour,
          score: Math.max(0, Math.min(100, score)),
          reasons: reasons.length > 0 ? reasons : ['Standard slot'],
          historicalSuccess: data.total > 0 ? Math.round((data.confirmed / data.total) * 100) : 50,
        });
      }
    }

    // Get top recommendations (only available slots)
    const recommendations = slotScores
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    // Calculate daily optimization scores
    const dailyScores = dayNames.map((name, day) => {
      const daySlots = slotScores.filter(s => s.day === day && s.score > 0);
      const avgScore = daySlots.length > 0 
        ? Math.round(daySlots.reduce((sum, s) => sum + s.score, 0) / daySlots.length)
        : 0;
      const availableSlots = daySlots.length;
      return { name: name.substring(0, 3), fullName: name, day, avgScore, availableSlots };
    });

    // Peak hours analysis
    const hourlyAverages = Array.from({ length: 10 }, (_, i) => {
      const hour = i + 8; // 8 AM to 5 PM
      const hourSlots = slotScores.filter(s => s.hour === hour);
      const avgScore = Math.round(hourSlots.reduce((sum, s) => sum + s.score, 0) / hourSlots.length);
      return { hour, label: format(setHours(new Date(), hour), 'h a'), avgScore };
    });

    const peakHours = hourlyAverages
      .filter(h => h.avgScore > 60)
      .map(h => h.label)
      .slice(0, 3);

    return { recommendations, dailyScores, peakHours, hourlyAverages };
  }, [events, weekDays]);

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-success';
    if (score >= 50) return 'text-brand-400';
    if (score >= 30) return 'text-warning';
    return 'text-destructive';
  };

  const getScoreBg = (score: number) => {
    if (score >= 70) return 'bg-success/20 border-success/30';
    if (score >= 50) return 'bg-brand-500/20 border-brand-500/30';
    if (score >= 30) return 'bg-warning/20 border-warning/30';
    return 'bg-destructive/20 border-destructive/30';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Resource Optimization
        </h3>
      </div>

      <div className="space-y-4">
          {/* Peak Hours Summary */}
          <Card className="p-3 bg-primary/5 border-primary/20">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium">Optimal Booking Windows</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {analysis.peakHours.map((hour, idx) => (
                <Badge key={idx} className="bg-primary/20 text-primary border-primary/30">
                  {hour}
                </Badge>
              ))}
              {analysis.peakHours.length === 0 && (
                <span className="text-xs text-muted-foreground">No clear peak hours detected</span>
              )}
            </div>
          </Card>

          {/* Top Recommendations */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Lightbulb className="h-3 w-3" />
              Recommended Time Slots
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {analysis.recommendations.map((slot, idx) => {
                const slotTime = resolveRecommendedSlot(slot.day, slot.hour);
                const nextWeek = fallsOutsideWeek(slotTime, weekStart);
                
                return (
                  <button
                    key={idx}
                    onClick={() => onSlotSelect?.(slotTime, slot.hour)}
                    className={cn(
                      'p-2 rounded-lg border text-left transition-all hover:scale-[1.02]',
                      getScoreBg(slot.score)
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">
                        {format(slotTime, 'EEE d MMM')} {format(slotTime, 'h:mm a')}
                        {nextWeek && (
                          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                            next week
                          </span>
                        )}
                      </span>
                      <span className={cn('text-xs font-bold', getScoreColor(slot.score))}>
                        {slot.score}%
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {slot.reasons[0]}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Daily Optimization Scores */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Daily Availability Score
            </h4>
            <div className="space-y-2">
              {analysis.dailyScores.map((day) => (
                <div key={day.day} className="flex items-center gap-2">
                  <span className="text-xs w-8">{day.name}</span>
                  <div className="flex-1">
                    <Progress value={day.avgScore} className="h-2" />
                  </div>
                  <span className={cn('text-xs font-medium w-12 text-right', getScoreColor(day.avgScore))}>
                    {day.avgScore}%
                  </span>
                  <span className="text-[10px] text-muted-foreground w-16">
                    {day.availableSlots} slots
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Hourly Heatmap */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Hourly Performance
            </h4>
            <div className="flex gap-1">
              {analysis.hourlyAverages.map((h) => (
                <div
                  key={h.hour}
                  className="flex-1 text-center"
                  title={`${h.label}: ${h.avgScore}% score`}
                >
                  <div
                    className={cn(
                      'h-8 rounded-sm mb-1 transition-all hover:scale-105',
                      h.avgScore >= 70 && 'bg-success/60',
                      h.avgScore >= 50 && h.avgScore < 70 && 'bg-brand-500/60',
                      h.avgScore >= 30 && h.avgScore < 50 && 'bg-warning/60',
                      h.avgScore < 30 && 'bg-destructive/30'
                    )}
                    style={{ opacity: 0.3 + (h.avgScore / 100) * 0.7 }}
                  />
                  <span className="text-[8px] text-muted-foreground">{h.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tips */}
          <Card className="p-3 bg-muted/30">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-success mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-medium">Optimization Tips</p>
                <ul className="text-[10px] text-muted-foreground space-y-0.5">
                  <li>• Schedule important meetings in the morning for better attendance</li>
                  <li>• Avoid back-to-back bookings to reduce no-shows</li>
                  <li>• Mid-week slots typically have the best show rates</li>
                </ul>
              </div>
            </div>
          </Card>
      </div>
    </div>
  );
}
