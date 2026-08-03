import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, FileText, FileDown, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ConversationReportEditor } from './ConversationReportEditor';
import { ReportQaDownloadButton } from './ReportQaDownloadButton';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ConversationExportProps {
  messages: Message[];
  title: string;
  reportNames: string[];
  conversationId?: string | null;
}

export function ConversationExport({ messages, title, reportNames, conversationId }: ConversationExportProps) {
  const { toast } = useToast();
  const [editorOpen, setEditorOpen] = useState(false);

  const exportAsText = () => {
    const header = `# ${title}\n\nReports: ${reportNames.join(', ')}\nExported: ${new Date().toLocaleString()}\n\n---\n\n`;
    
    const content = messages.map(m => {
      const timestamp = m.timestamp.toLocaleString();
      const role = m.role === 'user' ? '👤 You' : '🤖 Assistant';
      return `[${timestamp}] ${role}:\n${m.content}`;
    }).join('\n\n---\n\n');

    const blob = new Blob([header + content], { type: 'text/plain' });
    downloadBlob(blob, `${sanitizeFilename(title)}.txt`);
    
    toast({
      title: 'Exported',
      description: 'Conversation saved as text file',
    });
  };

  const exportAsMarkdown = () => {
    const header = `# ${title}\n\n**Reports:** ${reportNames.join(', ')}\n\n**Exported:** ${new Date().toLocaleString()}\n\n---\n\n`;
    
    const content = messages.map(m => {
      const timestamp = m.timestamp.toLocaleString();
      const role = m.role === 'user' ? '**You**' : '**Assistant**';
      return `### ${role}\n*${timestamp}*\n\n${m.content}`;
    }).join('\n\n---\n\n');

    const blob = new Blob([header + content], { type: 'text/markdown' });
    downloadBlob(blob, `${sanitizeFilename(title)}.md`);
    
    toast({
      title: 'Exported',
      description: 'Conversation saved as markdown file',
    });
  };

  const exportAsJSON = () => {
    const data = {
      title,
      reportNames,
      exportedAt: new Date().toISOString(),
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp.toISOString(),
      })),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${sanitizeFilename(title)}.json`);
    
    toast({
      title: 'Exported',
      description: 'Conversation saved as JSON file',
    });
  };

  const exportAsCSV = () => {
    const escapeCSV = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const headers = ['First Name', 'Last Name', 'Email', 'Phone', 'Tags', 'Source', 'Conversation Title', 'Reports', 'Exported At', 'Timestamp', 'Role', 'Content'];
    const exportedAt = new Date().toLocaleString();

    const rows = messages.map((message) => [
      '',
      '',
      '',
      '',
      'Q&A Export',
      'Report QA',
      title,
      reportNames.join(', '),
      exportedAt,
      message.timestamp.toLocaleString(),
      message.role === 'user' ? 'User' : 'Assistant',
      message.content,
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => escapeCSV(cell)).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `${sanitizeFilename(title)}.csv`);

    toast({
      title: 'Exported',
      description: 'Conversation saved as CSV file',
    });
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const sanitizeFilename = (name: string) => {
    return name.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
  };

  if (messages.length === 0) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="report-qa-toolbar-control h-8 gap-1.5 px-3 text-xs font-medium" title="Export conversation">
            <Download className="h-3 w-3" />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/*
            The typeset document, above the raster one. Both stay: this produces
            real text through WeasyPrint, the item below it still opens the
            jsPDF editor, and the four raw exports underneath are untouched —
            the .md one is what the typeset document's own truncation notice
            points at.
          */}
          {conversationId && (
            <div className="px-1 py-1">
              <ReportQaDownloadButton
                conversationId={conversationId}
                variant="ghost"
                className="w-full justify-start"
                label="Typeset PDF (WeasyPrint)"
              />
            </div>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setEditorOpen(true)}>
            <Sparkles className="h-4 w-4 mr-2 text-primary" />
            Export as Structured Report (AI)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={exportAsText}>
            <FileText className="h-4 w-4 mr-2" />
            Export Raw Transcript (.txt)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={exportAsCSV}>
            <FileDown className="h-4 w-4 mr-2" />
            Export for CSV (.csv)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={exportAsMarkdown}>
            <FileDown className="h-4 w-4 mr-2" />
            Export Raw Transcript (.md)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={exportAsJSON}>
            <FileDown className="h-4 w-4 mr-2" />
            Export Raw Data (.json)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConversationReportEditor
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        messages={messages}
        title={title}
        reportNames={reportNames}
        conversationId={conversationId}
      />
    </>
  );
}
