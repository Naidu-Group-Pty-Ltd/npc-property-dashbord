import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isBefore, isToday, startOfDay, startOfMonth, addDays } from 'date-fns';
import { AlertTriangle, Bell, CalendarClock, FileText } from 'lucide-react';
import { KpiRow, MetricTile } from '@/components/aurixa';
import { useAllReminders } from '@/hooks/useAllReminders';
import { supabase } from '@/integrations/supabase/client';

/**
 * The universal executive snapshot — operational metrics every tier
 * receives, built from data the core platform already holds (reminders,
 * follow-ups, deal milestones, report volume). Each tile opens the surface
 * where the work happens. Shares the `all-reminders` query with
 * UpcomingRemindersWidget, so it costs no extra requests.
 */
export function OperationsSnapshot({ showReports = true }: { showReports?: boolean }) {
  const navigate = useNavigate();
  const { data: reminders = [] } = useAllReminders();

  const { dueToday, overdue, dueThisWeek } = useMemo(() => {
    const today = startOfDay(new Date());
    const weekAhead = addDays(today, 7);
    let dueTodayCount = 0;
    let overdueCount = 0;
    let weekCount = 0;
    for (const reminder of reminders) {
      if (reminder.status !== 'pending') continue;
      const due = new Date(reminder.due_date);
      if (Number.isNaN(due.getTime())) continue;
      if (isToday(due)) dueTodayCount += 1;
      else if (isBefore(due, today)) overdueCount += 1;
      if (due >= today && due <= weekAhead) weekCount += 1;
    }
    return { dueToday: dueTodayCount, overdue: overdueCount, dueThisWeek: weekCount };
  }, [reminders]);

  const { data: reportsThisMonth } = useQuery({
    queryKey: ['overview-reports-this-month'],
    enabled: showReports,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('investment_reports')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', startOfMonth(new Date()).toISOString());
      if (error) throw error;
      return count ?? 0;
    },
  });

  return (
    <KpiRow columns={showReports ? 4 : 3}>
      <MetricTile
        title="Tasks Due Today"
        value={dueToday}
        icon={<Bell className="h-4 w-4" />}
        description="Reminders and follow-ups due today"
        tone="info"
        onClick={() => navigate('/reminders')}
      />
      <MetricTile
        title="Overdue Tasks"
        value={overdue}
        icon={<AlertTriangle className="h-4 w-4" />}
        description="Past-due reminders needing attention"
        tone={overdue > 0 ? 'warning' : undefined}
        onClick={() => navigate('/reminders')}
      />
      <MetricTile
        title="Due This Week"
        value={dueThisWeek}
        icon={<CalendarClock className="h-4 w-4" />}
        description="Upcoming tasks and milestones (7 days)"
        onClick={() => navigate('/reminders')}
      />
      {showReports && (
        <MetricTile
          title="Reports This Month"
          value={reportsThisMonth ?? '—'}
          icon={<FileText className="h-4 w-4" />}
          description="Investment reports generated this month"
          tone="success"
          onClick={() => navigate('/generated-reports')}
        />
      )}
    </KpiRow>
  );
}
