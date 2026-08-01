import { useCallback, useEffect, useState } from 'react';
import { FileText, ListChecks, Loader2, MessageSquare, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  BUILDER_SCOPE_TYPES, CONVERSATION_STATUS_LABELS, DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS, SCOPE_TYPE_LABELS, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS,
  formatCollaborationDate, formatCollaborationTime, formatFileSize, isDocumentRestricted,
  type BuilderConversation, type BuilderConversationStatus, type BuilderDocument,
  type BuilderDocumentGrant, type BuilderDocumentStatus, type BuilderDocumentType,
  type BuilderDocumentVersion, type BuilderMessage, type BuilderScopeType,
  type BuilderTask, type BuilderTaskPriority, type BuilderTaskStatus,
} from '@/lib/builderCollaboration';

/**
 * Internal Builder collaboration administration — documents and versions,
 * document permissions, conversations and messages, and tasks for one scope.
 *
 * Mirrors `AdminBuilderDeliveryPanel`. Every call goes through
 * `invokeSecureFunction`, which carries the staff session and the CSRF token;
 * `builder-collaboration-admin` re-checks the `builder_portal_admin` module
 * permission server-side, so nothing here is the authorization control.
 *
 * This is the INTERNAL surface. It never links to the external /builder/* portal.
 *
 * DATA BOUNDARY: a document's storage path is never requested or shown. Opening
 * a file asks the server for a short-lived signed URL.
 */

interface AdminProject { id: string; name: string }
interface AdminChild { id: string; label: string }

const TASK_STATUSES = Object.keys(TASK_STATUS_LABELS) as BuilderTaskStatus[];

export function AdminBuilderCollaborationPanel({ canEdit }: { canEdit: boolean }) {
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [scopeType, setScopeType] = useState<BuilderScopeType>('project');
  const [scopeId, setScopeId] = useState('');
  const [children, setChildren] = useState<AdminChild[]>([]);

  const [documents, setDocuments] = useState<BuilderDocument[]>([]);
  const [conversations, setConversations] = useState<BuilderConversation[]>([]);
  const [tasks, setTasks] = useState<BuilderTask[]>([]);

  const [openDocumentId, setOpenDocumentId] = useState('');
  const [versions, setVersions] = useState<BuilderDocumentVersion[]>([]);
  const [grants, setGrants] = useState<BuilderDocumentGrant[]>([]);
  const [openConversationId, setOpenConversationId] = useState('');
  const [messages, setMessages] = useState<BuilderMessage[]>([]);
  const [draft, setDraft] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (operation: string, payload: Record<string, unknown> = {}) => {
    const { data, error: invokeError } = await invokeSecureFunction(
      'builder-collaboration-admin', { operation, ...payload });
    if (invokeError || (data as any)?.error) {
      throw new Error((data as any)?.error || invokeError?.message || 'The request failed');
    }
    return data as any;
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const { data } = await invokeSecureFunction(
        'builder-projects-admin', { operation: 'list_projects', page: 1, page_size: 100 });
      const records = ((data as any)?.records ?? []) as AdminProject[];
      setProjects(records);
      setProjectId((current) => current || records[0]?.id || '');
    } catch (loadError: any) {
      setError(loadError?.message || 'Projects could not be loaded');
    }
  }, []);

  /**
   * The child list for the chosen scope type. Each comes from the admin function
   * that already owns that aggregate; this panel never queries a table directly.
   */
  const loadChildren = useCallback(async () => {
    if (scopeType === 'project' || !projectId) { setChildren([]); return; }
    try {
      if (scopeType === 'unit') {
        const { data } = await invokeSecureFunction('builder-inventory-admin', {
          operation: 'list_units', project_id: projectId, page: 1, page_size: 200,
        });
        setChildren((((data as any)?.records ?? []) as any[]).map((u) => ({
          id: u.id, label: u.unit_number || 'Unit',
        })));
      } else if (scopeType === 'transaction') {
        const { data } = await invokeSecureFunction('builder-transactions-admin', {
          operation: 'list_transactions', project_id: projectId, page: 1, page_size: 200,
        });
        setChildren((((data as any)?.records ?? []) as any[]).map((t) => ({
          id: t.id, label: t.transaction_reference || 'Transaction',
        })));
      } else {
        const { data } = await invokeSecureFunction('builder-construction-admin', {
          operation: 'list_cases', project_id: projectId, page: 1, page_size: 200,
        });
        setChildren((((data as any)?.records ?? []) as any[]).map((c) => ({
          id: c.id, label: c.case_reference || 'Build',
        })));
      }
    } catch (loadError: any) {
      setError(loadError?.message || 'That list could not be loaded');
    }
  }, [projectId, scopeType]);

  // Changing the project or scope type invalidates any child selection.
  useEffect(() => {
    setScopeId(scopeType === 'project' ? projectId : '');
    setOpenDocumentId(''); setOpenConversationId('');
  }, [projectId, scopeType]);

  const loadCollaboration = useCallback(async () => {
    if (!scopeType || !scopeId) {
      setDocuments([]); setConversations([]); setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const scope = { scope_type: scopeType, scope_id: scopeId };
      const [d, c, t] = await Promise.all([
        call('list_documents', scope),
        call('list_conversations', scope),
        call('list_tasks', scope),
      ]);
      setDocuments(d.records ?? []);
      setConversations(c.records ?? []);
      setTasks(t.records ?? []);
      setError(null);
    } catch (loadError: any) {
      setError(loadError?.message || 'Collaboration records could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [call, scopeId, scopeType]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);
  useEffect(() => { void loadChildren(); }, [loadChildren]);
  useEffect(() => { void loadCollaboration(); }, [loadCollaboration]);

  const openDocument = (documentId: string) => {
    setOpenDocumentId(documentId);
    setBusy(true);
    void (async () => {
      try {
        const result = await call('get_document', { document_id: documentId });
        setVersions(result.versions ?? []);
        setGrants(result.grants ?? []);
      } catch (actionError: any) {
        toast.error(actionError?.message || 'That document could not be opened');
      } finally {
        setBusy(false);
      }
    })();
  };

  const openConversation = (conversationId: string) => {
    setOpenConversationId(conversationId);
    setBusy(true);
    void (async () => {
      try {
        const result = await call('get_conversation', { conversation_id: conversationId });
        setMessages(result.messages ?? []);
      } catch (actionError: any) {
        toast.error(actionError?.message || 'That conversation could not be opened');
      } finally {
        setBusy(false);
      }
    })();
  };

  const openFile = (documentId: string, versionId: string) => {
    setBusy(true);
    void (async () => {
      try {
        const result = await call('document_url', { document_id: documentId, version_id: versionId });
        window.open(result.url, '_blank', 'noopener,noreferrer');
      } catch (actionError: any) {
        toast.error(actionError?.message || 'That file could not be opened');
      } finally {
        setBusy(false);
      }
    })();
  };

  const postMessage = () => {
    if (!draft.trim() || !openConversationId) return;
    setBusy(true);
    void (async () => {
      try {
        await call('post_message', { conversation_id: openConversationId, body: draft.trim() });
        setDraft('');
        toast.success('Message sent');
        openConversation(openConversationId);
        await loadCollaboration();
      } catch (actionError: any) {
        toast.error(actionError?.message || 'The message could not be sent');
      } finally {
        setBusy(false);
      }
    })();
  };

  /**
   * A task status change always carries the row_version the panel loaded. A
   * stale value is rejected by the server with 409 rather than overwritten.
   */
  const changeTaskStatus = (task: BuilderTask, status: BuilderTaskStatus) => {
    if (status === task.status) return;
    const reason = window.prompt('Give a reason for this change');
    if (!reason || !reason.trim()) return;
    setBusy(true);
    void (async () => {
      try {
        await call('upsert_task', {
          task_id: task.id, expected_version: task.row_version,
          status, reason: reason.trim(),
        });
        toast.success('Task updated');
        await loadCollaboration();
      } catch (actionError: any) {
        toast.error(actionError?.message || 'The task could not be updated');
      } finally {
        setBusy(false);
      }
    })();
  };

  const scopeChosen = Boolean(scopeType && scopeId);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Collaboration</CardTitle>
          <CardDescription>
            Documents, conversations and tasks for one project, unit, transaction or build.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-56" aria-label="Choose a project">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={scopeType}
            onValueChange={(next) => setScopeType(next as BuilderScopeType)}
          >
            <SelectTrigger className="w-44" aria-label="Choose a scope type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BUILDER_SCOPE_TYPES.map((value) => (
                <SelectItem key={value} value={value}>{SCOPE_TYPE_LABELS[value]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {scopeType !== 'project' ? (
            <Select value={scopeId} onValueChange={setScopeId} disabled={!children.length}>
              <SelectTrigger className="w-56" aria-label={`Choose a ${SCOPE_TYPE_LABELS[scopeType].toLowerCase()}`}>
                <SelectValue placeholder={`Choose a ${SCOPE_TYPE_LABELS[scopeType].toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                {children.map((child) => (
                  <SelectItem key={child.id} value={child.id}>{child.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => void loadCollaboration()} disabled={loading}>
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
            <span className="sr-only">Refresh</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!scopeChosen ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <p className="font-medium">Choose a record</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick a project, then narrow to a unit, transaction or build if you need to.
            </p>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading collaboration" />
          </div>
        ) : (
          <Tabs defaultValue="documents">
            <TabsList>
              <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
              <TabsTrigger value="conversations">Conversations ({conversations.length})</TabsTrigger>
              <TabsTrigger value="tasks">Tasks ({tasks.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="documents" className="mt-4 space-y-4">
              {!documents.length ? (
                <div className="rounded-lg border border-dashed p-10 text-center">
                  <FileText className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
                  <p className="mt-2 font-medium">No documents on this record</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Document</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Updated</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {documents.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell className="font-medium">{record.title}</TableCell>
                          <TableCell>
                            {DOCUMENT_TYPE_LABELS[record.document_type as BuilderDocumentType]}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {DOCUMENT_STATUS_LABELS[record.status as BuilderDocumentStatus]}
                            </Badge>
                          </TableCell>
                          <TableCell>{formatCollaborationDate(record.updated_at)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm" variant="outline" disabled={busy}
                              onClick={() => openDocument(record.id)}
                            >
                              Versions
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {openDocumentId ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Versions and permissions</CardTitle>
                    <CardDescription>
                      {isDocumentRestricted(grants)
                        ? 'This document is restricted to named people.'
                        : 'Everyone who can reach this record can see this document.'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!versions.length ? (
                      <p className="text-sm text-muted-foreground">No file attached yet.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Version</TableHead>
                            <TableHead>File</TableHead>
                            <TableHead>Size</TableHead>
                            <TableHead>Added</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {versions.map((version) => (
                            <TableRow key={version.id}>
                              <TableCell>v{version.version_number}</TableCell>
                              <TableCell>{version.file_name}</TableCell>
                              <TableCell>{formatFileSize(version.byte_size)}</TableCell>
                              <TableCell>{formatCollaborationTime(version.created_at)}</TableCell>
                              <TableCell className="text-right">
                                <Button
                                  size="sm" variant="outline" disabled={busy}
                                  onClick={() => openFile(openDocumentId, version.id)}
                                >
                                  Open
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              ) : null}
            </TabsContent>

            <TabsContent value="conversations" className="mt-4 space-y-4">
              {!conversations.length ? (
                <div className="rounded-lg border border-dashed p-10 text-center">
                  <MessageSquare className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
                  <p className="mt-2 font-medium">No conversations on this record</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subject</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Messages</TableHead>
                        <TableHead>Last message</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {conversations.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell className="font-medium">{record.subject}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {CONVERSATION_STATUS_LABELS[record.status as BuilderConversationStatus]}
                            </Badge>
                          </TableCell>
                          <TableCell>{record.message_count}</TableCell>
                          <TableCell>{formatCollaborationTime(record.last_message_at)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm" variant="outline" disabled={busy}
                              onClick={() => openConversation(record.id)}
                            >
                              Read
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {openConversationId ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Messages</CardTitle>
                    <CardDescription>
                      A message cannot be edited or removed once posted.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {!messages.length ? (
                      <p className="text-sm text-muted-foreground">No messages yet.</p>
                    ) : (
                      <ol className="space-y-2">
                        {messages.map((message) => (
                          <li key={message.id} className="rounded-md border border-border p-3">
                            <p className="text-sm whitespace-pre-wrap">{message.body}</p>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {message.author_display_name || 'Aurixa Systems'} ·{' '}
                              {formatCollaborationTime(message.created_at)}
                            </p>
                          </li>
                        ))}
                      </ol>
                    )}
                    <Textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="Reply to this conversation"
                      aria-label="Reply to this conversation"
                      rows={3}
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm" disabled={!canEdit || busy || !draft.trim()}
                        onClick={postMessage}
                      >
                        <Send className="mr-2 h-4 w-4" aria-hidden />Send
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </TabsContent>

            <TabsContent value="tasks" className="mt-4">
              {!tasks.length ? (
                <div className="rounded-lg border border-dashed p-10 text-center">
                  <ListChecks className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
                  <p className="mt-2 font-medium">No tasks on this record</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Task</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Due</TableHead>
                        <TableHead className="text-right">Move to</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tasks.map((task) => (
                        <TableRow key={task.id}>
                          <TableCell className="font-medium">{task.title}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {TASK_STATUS_LABELS[task.status as BuilderTaskStatus]}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {TASK_PRIORITY_LABELS[task.priority as BuilderTaskPriority]}
                          </TableCell>
                          <TableCell>{formatCollaborationDate(task.due_date)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-1">
                              {TASK_STATUSES.filter((status) => status !== task.status).map((status) => (
                                <Button
                                  key={status} size="sm" variant="outline"
                                  disabled={!canEdit || busy}
                                  onClick={() => changeTaskStatus(task, status)}
                                >
                                  {TASK_STATUS_LABELS[status]}
                                </Button>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
