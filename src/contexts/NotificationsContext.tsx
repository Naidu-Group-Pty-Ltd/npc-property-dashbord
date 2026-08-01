import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAuthenticatedSupabase } from '@/hooks/useAuthenticatedSupabase';
import { requestOpenInternalMessages } from '@/lib/internalMessagingBus';
import { resolveNotificationLink } from '@/lib/notificationLink';

export type NotificationType = 
  | 'report_generated' 
  | 'report_failed' 
  | 'info' 
  | 'call_completed' 
  | 'appointment_created' 
  | 'appointment_rescheduled' 
  | 'appointment_cancelled'
  // Phase 1 additions
  | 'client_reminder_due'
  | 'client_reminder_overdue'
  | 'call_alert_triggered'
  | 'missed_call'
  | 'email_received'
  | 'email_reply_sent'
  // Phase 2 additions - Report Lifecycle
  | 'report_generation_started'
  | 'report_generation_completed'
  | 'report_generation_failed'
  | 'report_regeneration_started'
  | 'report_regeneration_completed'
  | 'report_regeneration_failed'
  | 'report_archived'
  | 'report_restored'
  // Phase 3 additions - Client & Portfolio
  | 'client_created'
  | 'client_updated'
  | 'portfolio_updated'
  | 'formara_form_uploaded'
  | 'formara_form_exported'
  | 'finance_agent_notified'
  | 'client_file_shared'
  // Phase 4 additions - System & User
  | 'user_role_updated'
  | 'new_user_invited'
  | 'system_maintenance'
  | 'data_import_complete'
  | 'report_comment_added'
  // Phase 3 additions - Deal Lifecycle
  | 'deal_finance_expiry_warning'
  | 'deal_finance_expiry_overdue'
  | 'deal_settlement_warning'
  | 'deal_settlement_overdue'
  | 'deal_build_date_warning'
  // Phase 5 - Assignment notifications
  | 'reminder_assigned'
  | 'deal_assigned'
  | 'report_request'
  // Outlook calendar
  | 'outlook_event_created'
  // Phase 6 additions - Extended coverage
  | 'agreement_generated'
  | 'new_ghl_contact'
  | 'new_marketing_lead'
  | 'portal_report_requested'
  | 'client_reminder_upcoming'
  | 'conversation_shared'
  // Game Plan
  | 'game_plan_created'
  | 'game_plan_updated'
  | 'game_plan_milestone_completed'
  | 'conversation_reply'
  // Portal messaging
  | 'portal_message_received'
  | 'finance_portal_message_received'
  // Conversation sync
  | 'bulk_conversation_sync_completed'
  // Producers repaired in 20260803030000 — every one of these was writing a
  // column that did not exist on `notifications`, so none had ever been seen.
  | 'internal_message'
  | 'lender_submission_status'
  | 'purchase_file_unconditional_approval'
  | 'purchase_file_linked'
  | 'purchase_file_unlinked'
  | 'agent_insight'
  | 'agent_plan_scheduled'
  | 'market_qa_digest'
  | 'market_qa_subscription'
  | 'qa_conversation_shared'
  | 'client_data_updated'
  | 'client_property_added';

/**
 * The DB no longer enumerates notification types (it validates the slug format
 * only), so new backend/trigger types must never be dropped by the client.
 * The union above stays for autocomplete + routing; unknown slugs are allowed.
 */
export type AnyNotificationType = NotificationType | (string & {});

export interface Notification {
  id: string;
  type: AnyNotificationType;
  title: string;
  message: string;
  reportId?: string;

  entityId?: string;
  targetUserId?: string;
  timestamp: Date;
  read: boolean;
  /** Optional in-app path supplied by the producer. */
  link?: string;
  /** Producer-supplied context; `link_path`/`url` are honoured for routing. */
  metadata?: Record<string, unknown>;
}

interface NotificationsContextType {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearNotification: (id: string) => void;
  clearAll: () => void;
  handleNotificationClick: (notification: Notification) => void;
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const navigate = useNavigate();
  const { user, accessToken } = useAuth();
  const currentUserId = user?.id;
  // Notifications RLS is scoped to authenticated users (Phase 7) — direct
  // anon-key access is no longer permitted, so use the JWT-bearing client.
  const { supabase } = useAuthenticatedSupabase();

  const fetchNotifications = useCallback(async () => {
    try {
      let query = supabase
        .from('notifications')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(50);

      // Filter: show broadcast notifications (no target) + ones targeted to current user
      if (currentUserId) {
        query = query.or(`target_user_id.is.null,target_user_id.eq.${currentUserId}`);
      } else {
        query = query.is('target_user_id', null);
      }

      const { data, error } = await query;

      if (error) throw error;

      if (data) {
        const notificationsWithDates = data.map((n: any) => ({
          ...n,
          reportId: n.report_id,
          entityId: n.entity_id,
          targetUserId: n.target_user_id,
          link: typeof n.link === 'string' ? n.link : undefined,
          metadata: n.metadata && typeof n.metadata === 'object' ? n.metadata : undefined,
          timestamp: new Date(n.timestamp)
        }));
        setNotifications(notificationsWithDates);
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    }
  }, [currentUserId, supabase]);

  // Load notifications from Supabase on mount and when user changes
  useEffect(() => {
    fetchNotifications();
    
    // Subscribe to real-time changes (RLS applies; authorize with the JWT)
    if (accessToken) {
      try { supabase.realtime.setAuth(accessToken); } catch { /* non-fatal */ }
    }
    const channel = supabase
      .channel('notifications-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications'
        },
        () => {
          fetchNotifications();
        }
      )
      .subscribe();

    // Realtime is a best-effort transport, not a guarantee: corporate proxies
    // block WebSockets outright, the socket dies silently on sleep/resume, and
    // a CHANNEL_ERROR surfaces nowhere the user can see. When it fails the bell
    // simply freezes on whatever it had at mount, which reads as "notifications
    // are broken". Poll on an interval and whenever the tab regains focus so
    // the bell keeps filling in regardless of the socket's health.
    const refresh = () => {
      if (document.visibilityState === 'visible') fetchNotifications();
    };
    const poll = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);

    return () => {
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      supabase.removeChannel(channel);
    };
  }, [fetchNotifications, supabase, accessToken]);


  const addNotification = async (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .insert({
          type: notification.type,
          title: notification.title,
          message: notification.message,
          report_id: notification.reportId || null,
          entity_id: notification.entityId || null,
          target_user_id: notification.targetUserId || null,
          read: false
        });

      if (error) throw error;
      // Real-time subscription will handle updating the UI
    } catch (error) {
      console.error('Failed to add notification:', error);
    }
  };

  /**
   * Every mutation below applies to local state first.
   *
   * These used to write to the database and then wait for the realtime
   * subscription to echo the change back before the UI moved. When the socket
   * is not connected — the normal case behind a proxy that blocks WebSockets —
   * "Mark all read" and "Clear all" appeared to do nothing at all. Apply the
   * change immediately and re-sync from the server only if the write failed.
   */
  const markAsRead = async (id: string) => {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
    const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
    if (error) {
      console.error('Failed to mark notification as read:', error);
      fetchNotifications();
    }
  };

  const markAllAsRead = async () => {
    setNotifications(prev => prev.map(n => (n.read ? n : { ...n, read: true })));
    const { error } = await supabase.from('notifications').update({ read: true }).eq('read', false);
    if (error) {
      console.error('Failed to mark all as read:', error);
      fetchNotifications();
    }
  };

  const clearNotification = async (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    const { error } = await supabase.from('notifications').delete().eq('id', id);
    if (error) {
      console.error('Failed to clear notification:', error);
      fetchNotifications();
    }
  };

  const clearAll = async () => {
    setNotifications([]);
    // RLS narrows this to rows the caller may delete (their own + broadcasts).
    const { error } = await supabase
      .from('notifications')
      .delete()
      .gte('created_at', '1970-01-01');
    if (error) {
      console.error('Failed to clear all notifications:', error);
      fetchNotifications();
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    markAsRead(notification.id);
    
    switch (notification.type) {
      case 'report_generated':
      case 'report_generation_completed':
      case 'report_regeneration_completed':
        if (notification.reportId || notification.entityId) {
          localStorage.setItem('openReportId', notification.reportId || notification.entityId || '');
        }
        navigate('/generated-reports?tab=investment');
        break;
      case 'report_failed':
      case 'report_generation_failed':
      case 'report_regeneration_failed':
      case 'report_generation_started':
      case 'report_regeneration_started':
      case 'report_archived':
      case 'report_restored':
        navigate('/generated-reports?tab=investment');
        break;
      case 'call_completed':
      case 'missed_call':
        navigate('/call-logs');
        break;
      case 'call_alert_triggered':
        navigate('/call-logs');
        break;
      case 'appointment_created':
      case 'appointment_rescheduled':
      case 'appointment_cancelled':
        navigate('/calendar');
        break;
      case 'client_reminder_due':
      case 'client_reminder_overdue':
        if (notification.entityId) {
          navigate(`/clients?highlight=${notification.entityId}`);
        } else {
          navigate('/clients');
        }
        break;
      case 'email_received':
      case 'email_reply_sent':
        navigate('/email-copilot');
        break;
      case 'client_created':
      case 'client_updated':
      case 'portfolio_updated':
      case 'formara_form_uploaded':
      case 'formara_form_exported':
      case 'finance_agent_notified':
      case 'client_file_shared':
        if (notification.entityId) {
          navigate(`/clients?highlight=${notification.entityId}`);
        } else {
          navigate('/clients');
        }
        break;
      // Phase 4 - System & User
      case 'user_role_updated':
      case 'new_user_invited':
        navigate('/admin/users');
        break;
      case 'system_maintenance':
        // Just mark as read, no navigation
        break;
      case 'data_import_complete':
        navigate('/data-import');
        break;
      // Deal lifecycle notifications
      case 'deal_finance_expiry_warning':
      case 'deal_finance_expiry_overdue':
      case 'deal_settlement_warning':
      case 'deal_settlement_overdue':
      case 'deal_build_date_warning':
        if (notification.entityId) {
          navigate(`/clients?highlight=${notification.entityId}`);
        } else {
          navigate('/deal-pipeline');
        }
        break;
      case 'report_comment_added':
        if (notification.reportId || notification.entityId) {
          localStorage.setItem('openReportId', notification.reportId || notification.entityId || '');
        }
        navigate('/generated-reports?tab=investment');
        break;
      case 'reminder_assigned':
        if (notification.entityId) {
          navigate(`/clients?highlight=${notification.entityId}`);
        } else {
          navigate('/reminders');
        }
        break;
      case 'deal_assigned':
        if (notification.entityId) {
          navigate(`/deal-pipeline`);
        } else {
          navigate('/deal-pipeline');
        }
        break;
      case 'report_request':
      case 'portal_report_requested':
        if (notification.entityId) {
          navigate(`/report-requests?highlight=${notification.entityId}`);
        } else {
          navigate('/report-requests');
        }
        break;
      case 'agreement_generated':
        if (notification.entityId) {
          navigate(`/clients?highlight=${notification.entityId}`);
        }
        break;
      case 'new_ghl_contact':
        if (notification.entityId) {
          navigate(`/clients?highlight=${notification.entityId}`);
        } else {
          navigate('/clients');
        }
        break;
      case 'new_marketing_lead':
        if (notification.entityId) {
          navigate(`/clients?highlight=${notification.entityId}`);
        } else {
          navigate('/marketing-analytics');
        }
        break;
      case 'client_reminder_upcoming':
        if (notification.entityId) {
          navigate(`/clients?highlight=${notification.entityId}`);
        } else {
          navigate('/reminders');
        }
        break;
      case 'conversation_reply':
        if (notification.entityId) {
          // entityId is the client_id; find conversation to deep-link
          // For now navigate to conversations page — the notification trigger stores client_id as entity_id
          // We'll look up the conversation ID from the conversations list
          navigate(`/conversations`);
        } else {
          navigate('/conversations');
        }
        break;
      case 'conversation_shared':
        // Open the Oryxa agent widget and navigate to the shared conversation
        window.dispatchEvent(new CustomEvent('open-agent-conversation', { 
          detail: { conversationId: notification.entityId, tab: 'shared_with_me' } 
        }));
        break;
      case 'game_plan_created':
      case 'game_plan_updated':
      case 'game_plan_milestone_completed':
        navigate('/game-plan');
        break;
      case 'portal_message_received':
        if (notification.entityId) {
          navigate(`/clients?clientId=${notification.entityId}&tab=portal-messages`);
        } else {
          navigate('/clients');
        }
        break;
      case 'finance_portal_message_received':
        if (notification.entityId) {
          navigate(`/clients?clientId=${notification.entityId}&tab=finance-messages`);
        } else {
          navigate('/clients');
        }
        break;
      case 'bulk_conversation_sync_completed':
        navigate('/conversations');
        break;
      case 'internal_message':
        // Internal messaging lives in the Aurixa widget, not on a route.
        // `entity_id` is the thread id.
        requestOpenInternalMessages(notification.entityId);
        break;
      default: {
        // Types added by the backend no longer need a `case` here: producers
        // ship `link` (or `metadata.link_path`) and we follow it.
        const target = resolveNotificationLink(notification);
        if (target) navigate(target);
        break;
      }
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        unreadCount,
        addNotification,
        markAsRead,
        markAllAsRead,
        clearNotification,
        clearAll,
        handleNotificationClick
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationsProvider');
  }
  return context;
}

/**
 * Non-throwing variant. Returns null when no provider is mounted (e.g. during
 * an HMR partial refresh) so background listeners never blank the screen.
 */
export function useNotificationsOptional() {
  return useContext(NotificationsContext) ?? null;
}

