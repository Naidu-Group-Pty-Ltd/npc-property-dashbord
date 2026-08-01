import { useRef, useCallback, useMemo, useState } from 'react';
import { LiveModelBadge, ModelUpgradeButton } from '@/components/agentModels';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { 
  Home, 
  Building2, 
  Calendar, 
  Mail, 
  BarChart3, 
  FileText, 
  Settings,
  Search,
  Filter,
  Download,
  Eye,
  AlertCircle,
  CheckCircle,
  Clock,
  Target,
  Users,
  Phone,
  Zap,
  PieChart,
  Palette,
  Upload,
  Shield,
  Activity,
  Keyboard,
  Bot,
  Calculator,
  FolderOpen,
  MessageSquare,
  Headphones,
  Bell,
  Briefcase,
  TrendingUp,
  DollarSign,
  FileSpreadsheet,
  UserCog,
  Database,
  LayoutDashboard,
  Mic,
  Sparkles,
  Webhook,
  X,
  ShieldCheck,
  Landmark,
  Scale,
  Hammer,
  Newspaper,
  Cpu,
  Handshake,
  BarChart4,
  FileInput,
  CreditCard,
  Banknote,
  BookOpen,
  Lock,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openDocumentation } from '@/lib/missionControl';
import { UserGuideAssistant } from '@/components/user-guide/UserGuideAssistant';
import { ADDITIONAL_GUIDE_SECTIONS } from '@/lib/userGuideSections';
import { filterEntitledSections, lockedSections } from '@/lib/userGuideEntitlements';
import { usePlanEntitlements } from '@/hooks/usePlanEntitlements';

/**
 * Icons for the data-defined sections. `userGuideSections.ts` names its icon as
 * a string so it can be imported by the AI knowledge base, which has no React
 * dependency — the mapping back to a component belongs here, in the UI.
 */
const GUIDE_SECTION_ICONS: Record<string, React.ElementType> = {
  ShieldCheck,
  Landmark,
  Scale,
  Hammer,
  Building2,
  Newspaper,
  Cpu,
  Target,
  Handshake,
  BarChart4,
  FileInput,
  CreditCard,
  Banknote,
  BookOpen,
  Keyboard,
  AlertCircle,
};
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

interface GuideSection {
  id: string;
  title: string;
  icon: React.ElementType;
  description: string;
  items: GuideItem[];
}

interface GuideItem {
  title: string;
  description: string;
  features?: string[];
  steps?: string[];
  tips?: string[];
  shortcuts?: { keys: string[]; description: string }[];
}

export default function UserGuide() {
  const { planSlug, addonSlugs, loading: planLoading } = usePlanEntitlements();
  const accordionRef = useRef<string[]>([]);
  
  const handleNavigateToSection = useCallback((sectionId: string) => {
    // Find and scroll to the section
    const element = document.getElementById(`section-${sectionId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Open the accordion
      accordionRef.current = [sectionId];
      // Trigger a click on the accordion trigger to open it
      const trigger = element.querySelector('[data-state]');
      if (trigger && trigger.getAttribute('data-state') === 'closed') {
        (trigger as HTMLElement).click();
      }
    }
  }, []);
  const allSections: GuideSection[] = [
    {
      id: 'getting-started',
      title: 'Getting Started',
      icon: Home,
      description: 'Essential navigation and dashboard overview',
      items: [
        {
          title: 'Dashboard Overview',
          description: 'The main dashboard provides a comprehensive view of your property data with key performance indicators (KPIs), charts, and recent activity.',
          features: [
            'Real-time data updates across all modules',
            'Interactive charts and visualizations',
            'Quick access to all sections via sidebar navigation',
            'Notification center for alerts and updates',
          ],
        },
        {
          title: 'Navigation & Sidebar',
          description: 'Use the collapsible sidebar to navigate between different sections. The active page is highlighted for easy reference.',
          features: [
            'Collapsible sidebar for more screen space',
            'Quick search functionality (Ctrl/⌘ + K)',
            'User profile and settings access',
            'Role-based menu visibility',
          ],
        },
      ],
    },
    {
      id: 'client-management',
      title: 'Client Management',
      icon: Users,
      description: 'Comprehensive CRM for managing investor clients',
      items: [
        {
          title: 'Client Tracker',
          description: 'The Client Tracker is your central hub for managing all client relationships, tracking their investment journey, and maintaining detailed records.',
          features: [
            'Client cards with key financial summaries',
            'Pipeline stage tracking for each client',
            'Favorite clients for quick access',
            'Advanced filtering by status, tags, and activity',
            'Bulk actions for efficient management',
          ],
          steps: [
            'Navigate to "Client Tracker" in the sidebar',
            'Use the search bar to find specific clients',
            'Click on a client card to view full details',
            'Use tabs to navigate between Personal, Employment, Financials, Properties, Emails, Notes, and Reports',
            'Update client information directly in the modal',
          ],
        },
        {
          title: 'Client Details & Financials',
          description: 'Each client profile contains comprehensive financial information for borrowing capacity and portfolio analysis.',
          features: [
            'Personal and employment details',
            'Income sources with multiple entry types',
            'Expense tracking by category',
            'Assets and liabilities management',
            'Property portfolio overview',
            'Borrowing capacity calculations',
          ],
        },
        {
          title: 'Client Notes & Reminders',
          description: 'Keep detailed notes and set reminders for follow-ups and important dates.',
          features: [
            'Rich text notes with timestamps',
            'Voice note recording capability',
            'Reminder scheduling with priority levels',
            'Activity timeline showing all interactions',
          ],
        },
        {
          title: 'Client Tags & Segmentation',
          description: 'Organize clients with custom tags for better segmentation and targeting.',
          features: [
            'Create custom colored tags',
            'Assign multiple tags per client',
            'Filter clients by tag combinations',
            'Bulk tag assignment',
          ],
        },
        {
          title: 'Portfolio Analysis Reports',
          description: 'Generate comprehensive portfolio health reports for your clients.',
          features: [
            'Overall portfolio health scoring',
            'Property-by-property breakdown',
            'Equity and cashflow analysis',
            'LVR and yield calculations',
            'PDF export with professional formatting',
          ],
          steps: [
            'Open a client\'s details modal',
            'Navigate to the "Reports" tab',
            'Click "Generate Portfolio Analysis"',
            'Wait for the AI to analyze all properties',
            'Download the PDF report',
          ],
        },
      ],
    },
    {
      id: 'email-copilot',
      title: 'Email Copilot',
      icon: Mail,
      description: 'AI-powered email management and automation',
      items: [
        {
          title: 'Email Overview',
          description: 'The Email Copilot centralizes all client communications with AI-powered features for drafting, summarizing, and managing emails.',
          features: [
            'Unified inbox for admin and personal mailboxes',
            'AI-generated email summaries',
            'Smart draft replies with context awareness',
            'Urgency detection and prioritization',
            'Client linking for organized communications',
          ],
        },
        {
          title: 'Managing Emails',
          description: 'Process and organize incoming emails efficiently with AI assistance.',
          steps: [
            'Navigate to "Email Copilot" in the sidebar',
            'View inbox organized by urgency and status',
            'Click on an email to see full content and AI summary',
            'Use "Generate AI Reply" for smart draft responses',
            'Link emails to specific clients for tracking',
            'Mark emails as processed when complete',
          ],
        },
        {
          title: 'Linking Emails to Clients',
          description: 'Associate email threads with specific clients for organized tracking.',
          features: [
            'Search and select clients from the dropdown',
            'View all linked emails in client details',
            'Track communication history per client',
            'Quick access from both Email Copilot and Client Tracker',
          ],
        },
        {
          title: 'Email Actions',
          description: 'Take action on emails directly from the copilot interface.',
          features: [
            'Generate AI-powered reply drafts',
            'Mark as processed/pending/follow-up',
            'Set urgency levels (low, normal, high, critical)',
            'Compose and send replies with signature',
            'Archive completed conversations',
          ],
        },
      ],
    },
    {
      id: 'report-qa',
      title: 'Aurixa Intelligence Hub (AI Chat)',
      icon: Bot,
      description: 'AI-powered assistant for property report analysis',
      items: [
        {
          title: 'AI Chat Overview',
          description: 'The Aurixa Intelligence Hub feature allows you to have natural conversations with an AI assistant that has access to your property reports and market data.',
          features: [
            'Natural language queries about properties',
            'Context-aware responses using your report data',
            'Multi-turn conversations with memory',
            'PDF document attachment and analysis',
            'Voice message input support',
          ],
        },
        {
          title: 'Using the AI Chat',
          description: 'Ask questions about properties, market trends, and investment analysis.',
          steps: [
            'Navigate to "Aurixa Intelligence Hub" in the sidebar',
            'Select reports from the sidebar to provide context',
            'Type your question in the message input',
            'Use voice recording for hands-free input',
            'Review AI responses with source citations',
            'Follow up with clarifying questions',
          ],
          tips: [
            'Attach specific reports for more accurate answers',
            'Ask comparative questions across multiple properties',
            'Request summaries of complex report sections',
            'Use follow-up suggestions for deeper analysis',
          ],
        },
        {
          title: 'Conversation Management',
          description: 'Organize and manage your AI chat history.',
          features: [
            'Pin important conversations',
            'Tag conversations by topic',
            'Search conversation history (⌘/Ctrl + K)',
            'Export conversations as PDF or text',
            'Start new chats (⌘/Ctrl + N)',
          ],
        },
        {
          title: 'Advanced Features',
          description: 'Power user features for enhanced productivity.',
          features: [
            'Full-screen mode (⌘/Ctrl + Enter)',
            'Text-to-speech for responses',
            'Message reactions for feedback',
            'Auto-summarize long responses',
            'Theme customization',
            'Accessibility settings',
          ],
        },
      ],
    },
    {
      id: 'property-management',
      title: 'Property Management',
      icon: Building2,
      description: 'View and manage property listings',
      items: [
        {
          title: 'Property Marketplace',
          description: 'View and manage all property listings with advanced filtering and search capabilities.',
          features: [
            'Search by address, suburb, or postcode',
            'Filter by property type, price range, and status',
            'View detailed property information',
            'Generate investment reports for individual properties',
            'Compare multiple properties side-by-side',
          ],
        },
        {
          title: 'Property Filters',
          description: 'Use filters to narrow down properties based on your criteria.',
          features: [
            'State and suburb filtering',
            'Property type selection (house, unit, land, etc.)',
            'Price range filtering with min/max',
            'Status filtering (active, pending, sold, withdrawn)',
            'Save filter presets for quick access',
          ],
        },
        {
          title: 'Property Details',
          description: 'View comprehensive information about each property.',
          features: [
            'Property specifications and features',
            'Price history and market comparison',
            'Location insights and amenities',
            'Agent and agency information',
            'Quick report generation buttons',
          ],
        },
      ],
    },
    {
      id: 'cash-flow-analysis',
      title: 'Cash Flow Analysis',
      icon: DollarSign,
      description: 'Detailed property cash flow modeling',
      items: [
        {
          title: 'Cash Flow Calculator',
          description: 'Model the cash flow of investment properties with detailed income and expense projections.',
          features: [
            'Rental income projections',
            'Operating expense calculations',
            'Loan repayment modeling',
            'Tax benefit analysis',
            'Net cash flow visualization',
          ],
        },
        {
          title: 'Scenario Comparison',
          description: 'Compare different investment scenarios side-by-side.',
          features: [
            'Multiple property comparison',
            'Interest rate sensitivity analysis',
            'Occupancy rate impact modeling',
            'Growth rate projections',
            'Export comparison reports',
          ],
        },
      ],
    },
    {
      id: 'borrowing-capacity',
      title: 'Borrowing Capacity',
      icon: Calculator,
      description: 'Calculate client borrowing power',
      items: [
        {
          title: 'Capacity Calculator',
          description: 'Calculate borrowing capacity based on income, expenses, and existing commitments using bank-approved methodologies.',
          features: [
            'Gross and net income calculation',
            'Living expense modeling (HEM/declared)',
            'Existing commitment factoring',
            'Buffer rate application',
            'Serviceability assessment',
          ],
        },
        {
          title: 'Conservative Mode',
          description: 'Apply stricter lending criteria for more realistic capacity estimates.',
          features: [
            '$1,000/mo minimum surplus floor',
            '$1,500 residual income floor',
            '85% surplus utilization',
            '6x DTI (debt-to-income) cap',
            'Lender-specific adjustments',
          ],
          tips: [
            'Use Conservative Mode for client-facing quotes',
            'Standard mode shows theoretical maximum',
            'Compare both modes to set expectations',
          ],
        },
        {
          title: 'Saving Assessments',
          description: 'Save borrowing capacity assessments to client profiles.',
          steps: [
            'Complete the borrowing capacity calculation',
            'Review the results and recommendations',
            'Click "Save to Client" button',
            'Select the client from the dropdown',
            'Access saved assessments from client details',
          ],
        },
      ],
    },
    {
      id: 'call-logs',
      title: 'Call Logs',
      icon: Phone,
      description: 'AI-powered call recording and analysis',
      items: [
        {
          title: 'Call Management',
          description: 'Track and analyze all client calls with AI-powered transcription and insights.',
          features: [
            'Automatic call recording',
            'AI transcription of conversations',
            'Sentiment analysis',
            'Key topic extraction',
            'Call duration and status tracking',
          ],
        },
        {
          title: 'Call Analysis',
          description: 'Extract insights from recorded calls.',
          features: [
            'Full transcript review',
            'Speaker identification',
            'Action item extraction',
            'Follow-up task creation',
            'Client linking for context',
          ],
        },
        {
          title: 'Alert Rules',
          description: 'Set up automated alerts based on call content or metrics.',
          features: [
            'Keyword-based triggers',
            'Duration thresholds',
            'Sentiment-based alerts',
            'Custom notification rules',
            'Team notification routing',
          ],
        },
      ],
    },
    {
      id: 'automation',
      title: 'Auto Report Generation',
      icon: Zap,
      description: 'Automated report generation and workflows',
      items: [
        {
          title: 'Auto-Report Switches',
          description: 'Configure automated report generation based on property criteria.',
          features: [
            'Criteria-based triggers (price, location, type)',
            'Priority ordering for multiple switches',
            'Enable/disable individual switches',
            'Generation logging and history',
            'Master toggle for all automation',
          ],
          steps: [
            'Navigate to "Auto Report Generation" in the sidebar',
            'Click "Add Switch" to create a new automation',
            'Configure trigger criteria (state, price range, property type)',
            'Set priority order for switch evaluation',
            'Enable the switch and master toggle',
            'Monitor generation logs for activity',
          ],
        },
        {
          title: 'Generation Logs',
          description: 'View history of all automated report generations.',
          features: [
            'Success/failure status for each generation',
            'Property details and switch that triggered',
            'Error messages for troubleshooting',
            'Timestamp and duration tracking',
            'Link to generated reports',
          ],
        },
      ],
    },
    {
      id: 'reports-analytics',
      title: 'Reports & Analytics',
      icon: BarChart3,
      description: 'Investment reports and data visualization',
      items: [
        {
          title: 'Investment Report Generation',
          description: 'Create comprehensive property investment analysis reports with AI-powered insights.',
          features: [
            '13-section comprehensive analysis',
            'Market KPIs and pricing trends',
            'Demographics and demand analysis',
            'Risk assessment (flood, bushfire, crime)',
            'Financial projections and scenarios',
            'Investment scoring (0-100)',
          ],
          steps: [
            'Go to "Property Marketplace" and find your target property',
            'Click "Generate Report" on the property card',
            'Choose analysis mode (Address/Postcode/State)',
            'Configure financial assumptions',
            'Wait for AI analysis (2-5 minutes)',
            'Review and download the report',
          ],
        },
        {
          title: 'Generated Reports',
          description: 'Access and manage all your generated investment reports.',
          features: [
            'Report library with search and filters',
            'PDF download and sharing',
            'Report versioning history',
            'Bookmarking for quick access',
            'Usage analytics',
          ],
        },
        {
          title: 'Charts & Visualization',
          description: 'Create custom charts for market analysis and presentations.',
          features: [
            'Multiple chart types (bar, line, pie, scatter)',
            'Custom data filtering and grouping',
            'Export as images or PDFs',
            'Real-time data updates',
            'Comparative analysis tools',
          ],
        },
        {
          title: 'Portfolio Reports',
          description: 'Generate portfolio-level analysis across multiple properties.',
          features: [
            'Multi-property health scoring',
            'Diversification analysis',
            'Combined cash flow projections',
            'Risk distribution overview',
            'Client-ready PDF exports',
          ],
        },
      ],
    },
    {
      id: 'data-import',
      title: 'Data Import',
      icon: Upload,
      description: 'Import client and property data',
      items: [
        {
          title: 'Excel Import',
          description: 'Bulk import clients and properties from Excel spreadsheets.',
          features: [
            'Template download for correct formatting',
            'Column mapping assistance',
            'Validation and error reporting',
            'Duplicate detection',
            'Import history logging',
          ],
          steps: [
            'Navigate to "Data Import" in the sidebar',
            'Download the import template',
            'Fill in your data following the template format',
            'Upload the completed spreadsheet',
            'Review validation results',
            'Confirm and complete the import',
          ],
        },
        {
          title: 'Client Detail Forms',
          description: 'Import client data from client detail form submissions.',
          features: [
            'Automatic form parsing',
            'Client profile creation',
            'Income and expense extraction',
            'Property detail import',
            'Document attachment linking',
          ],
        },
      ],
    },
    {
      id: 'templates',
      title: 'Template Management',
      icon: FileText,
      description: 'Manage report templates and PDF layouts',
      items: [
        {
          title: 'Report Format Templates',
          description: 'Configure templates for different report types including Investment Compass, Executive Brief, and Snapshot reports.',
          features: [
            'Investment report templates (Compass, Executive, Snapshot)',
            'Comparison analysis templates',
            'Individual cash flow templates',
            'Template priority ordering',
            'Category-based organization',
          ],
        },
        {
          title: 'AI Structure Templates',
          description: 'Reference documents that define report structure and content patterns for AI generation.',
          features: [
            'Upload reference PDFs for AI learning',
            'Vector embedding for context injection',
            'Template type categorization',
            'Priority-based template selection',
          ],
          steps: [
            'Navigate to "Templates" in the sidebar',
            'Select the "AI Structure" tab',
            'Click "Upload Template" and select your reference PDF',
            'Configure category and priority settings',
            'Save to enable for report generation',
          ],
        },
        {
          title: 'PDF Layout Templates',
          description: 'HTML/CSS templates that control the visual layout and styling of generated PDF reports.',
          features: [
            'Custom header and footer designs',
            'Page layout configurations',
            'Font and color scheme settings',
            'Section ordering and visibility',
          ],
        },
        {
          title: 'Q&A Export Templates',
          description: 'Customize how Aurixa Intelligence Hub conversations are exported to PDF.',
          features: [
            'Cover page design customization',
            'Font and color settings',
            'Header and footer styling',
            'Active template selection',
          ],
        },
        {
          title: 'Cash Flow Export Templates',
          description: 'Customize how 10-Year Cash Flow analyses are exported.',
          features: [
            'Branding and logo placement',
            'Color scheme customization',
            'Professional PDF formatting',
            'Template activation toggle',
          ],
        },
        {
          title: 'Client Branding Profiles',
          description: 'Create white-label branding for different clients.',
          features: [
            'Client-specific logos and colors',
            'Multiple saved profiles',
            'Default profile setting',
            'Per-report branding selection',
          ],
        },
        {
          title: 'Global Report Settings',
          description: 'Configure default settings that apply to all reports.',
          features: [
            'Default assumptions and values',
            'Standard disclaimers',
            'Contact information',
            'Footer content settings',
          ],
        },
      ],
    },
    {
      id: 'sources',
      title: 'Data Sources',
      icon: Database,
      description: 'Track and manage listing data sources',
      items: [
        {
          title: 'Email Sources',
          description: 'View and manage email sources that send property listings.',
          features: [
            'Email domain tracking',
            'Listing count per source',
            'Latest received timestamps',
            'Source filtering and search',
          ],
        },
        {
          title: 'Agency Sources',
          description: 'Track real estate agencies and their listing activity.',
          features: [
            'Agency name and contact info',
            'Associated agents list',
            'Listing volume tracking',
            'Activity timeline',
          ],
        },
        {
          title: 'Agent Sources',
          description: 'Individual agent tracking and contact management.',
          features: [
            'Agent contact details',
            'Agency affiliation',
            'Listing history',
            'Phone and email quick actions',
          ],
        },
      ],
    },
    {
      id: 'integrations',
      title: 'Integrations',
      icon: Webhook,
      description: 'Configure external service connections',
      items: [
        {
          title: 'Integration Overview',
          description: 'Connect and manage external services for enhanced functionality.',
          features: [
            'Airtable for property listings',
            'Vapi for voice AI and call handling',
            'GoHighLevel for CRM sync',
            'OpenAI for AI analysis',
            'Microsoft/Outlook for email',
            'Twilio for SMS communications',
            'Make.com for workflow automation',
          ],
        },
        {
          title: 'Configuring Integrations',
          description: 'Set up API keys and credentials for each service.',
          steps: [
            'Navigate to "Integrations" in the sidebar',
            'Select the integration you want to configure',
            'Enter the required API keys or credentials',
            'Click "Save" to store the configuration',
            'Use "Sync to Supabase" to enable for edge functions',
            'Verify connection status shows "Configured"',
          ],
          tips: [
            'Keep API keys secure and never share them',
            'Use the visibility toggle to verify key values',
            'Check documentation links for each service',
            'Refresh Supabase status after syncing',
          ],
        },
        {
          title: 'Supabase Secrets',
          description: 'Manage secrets for edge function access.',
          features: [
            'Sync API keys to Supabase secrets',
            'Status indicators for each integration',
            'Partial configuration warnings',
            'One-click refresh for status',
          ],
        },
      ],
    },
    {
      id: 'depreciation',
      title: 'Depreciation Comps',
      icon: Calculator,
      description: 'Manage depreciation comparable data',
      items: [
        {
          title: 'Depreciation Database',
          description: 'Maintain a database of property depreciation comparables for accurate estimates.',
          features: [
            'Property type categorization',
            'Build year and purchase date tracking',
            'Finish standard classification',
            'City-based regional data',
            '10-year depreciation projections',
          ],
        },
        {
          title: 'Adding Comparables',
          description: 'Add new depreciation comparable data to the system.',
          steps: [
            'Navigate to Admin > Depreciation Comps',
            'Click "Add New" to create a manual entry',
            'Fill in property details and depreciation values',
            'Or use CSV upload for bulk imports',
            'Review and save the data',
          ],
        },
        {
          title: 'CSV Import',
          description: 'Bulk import depreciation data from spreadsheets.',
          features: [
            'Template download for correct formatting',
            'Column mapping validation',
            'Preview before import',
            'Error reporting for invalid rows',
          ],
          tips: [
            'Download the template first to ensure correct format',
            'Include all 10 years of depreciation values',
            'Specify property type and finish standard',
            'Review preview before confirming import',
          ],
        },
        {
          title: 'Depreciation Estimator',
          description: 'Generate depreciation estimates based on property characteristics.',
          features: [
            'Match against comparable properties',
            'Confidence scoring',
            'Plant & Equipment (P&E) estimates',
            'Division 40/43 calculations',
          ],
        },
      ],
    },
    {
      id: 'settings',
      title: 'Settings',
      icon: Settings,
      description: 'Configure your personal preferences',
      items: [
        {
          title: 'Profile & Credentials',
          description: 'Manage your account settings and security.',
          features: [
            'Password change',
            'Profile information',
            'Session management',
            'Two-factor authentication setup',
          ],
        },
        {
          title: 'Personal Mailbox',
          description: 'Configure your email settings for the Email Copilot.',
          features: [
            'Personal mailbox address',
            'Email signature customization',
            'HTML signature support',
            'Auto-append to sent emails',
          ],
        },
        {
          title: 'Finance Agent Contacts',
          description: 'Manage contacts for finance-related communications.',
          features: [
            'Add finance broker contacts',
            'Set default recipients',
            'Contact categorization',
            'Quick access for report sending',
          ],
        },
        {
          title: 'Display & Preferences',
          description: 'Customize your dashboard experience.',
          features: [
            'Theme selection (Light/Dark/System)',
            'Timezone configuration',
            'Browser notification settings',
            'Auto-refresh intervals',
          ],
        },
        {
          title: 'Report Generation',
          description: 'Configure automatic report generation behavior.',
          features: [
            'Auto-continue for stalled reports',
            'Maximum retry attempts (1-5)',
            'Retry delay configuration (10-60s)',
            'Notification preferences',
          ],
          tips: [
            'Enable auto-continue for unattended report generation',
            'Set reasonable retry limits to avoid loops',
            'Adjust delay based on network conditions',
          ],
        },
        {
          title: 'Security & Access',
          description: 'View your permission levels and API access.',
          features: [
            'API token status',
            'User permission levels',
            'Read/write access indicators',
            'Export permissions',
          ],
        },
      ],
    },
    {
      id: 'white-label',
      title: 'Branding (White Label)',
      icon: Palette,
      description: 'Customize dashboard and report branding',
      items: [
        {
          title: 'Dashboard Branding',
          description: 'Customize the overall look and feel of your dashboard.',
          features: [
            'Auth page logo upload',
            'Sidebar logo (expanded and collapsed)',
            'Favicon customization',
            'Automatic background removal for logos',
          ],
          steps: [
            'Navigate to "White Label" in the sidebar',
            'Upload logos for each placement',
            'Use drag-and-drop or click to upload',
            'Preview changes in real-time',
            'Save to apply across the dashboard',
          ],
        },
        {
          title: 'Color Themes',
          description: 'Configure your brand colors for the dashboard.',
          features: [
            'Primary color selection',
            'Accent color customization',
            'HSL format for precise control',
            'Real-time preview',
            'CSS variable injection',
          ],
        },
        {
          title: 'Dark Mode',
          description: 'Control dark mode appearance.',
          features: [
            'Light/Dark/System theme toggle',
            'Theme persistence across sessions',
            'Automatic system preference detection',
          ],
        },
        {
          title: 'Report Branding',
          description: 'White-label generated reports for clients.',
          features: [
            'Company logo on reports',
            'Custom color schemes',
            'Header and footer styling',
            'Contact information display',
            'Multiple branding profiles',
          ],
        },
      ],
    },
    {
      id: 'calendar',
      title: 'Calendar & Scheduling',
      icon: Calendar,
      description: 'Track appointments and important dates',
      items: [
        {
          title: 'Calendar View',
          description: 'Manage appointments, follow-ups, and property-related events.',
          features: [
            'Day, week, and month views',
            'Client appointment scheduling',
            'Property inspection tracking',
            'Reminder notifications',
            'Integration with client reminders',
          ],
        },
        {
          title: 'Keyboard Navigation',
          description: 'Navigate the calendar efficiently with keyboard shortcuts.',
          shortcuts: [
            { keys: ['T'], description: 'Go to today' },
            { keys: ['←'], description: 'Previous period' },
            { keys: ['→'], description: 'Next period' },
            { keys: ['D'], description: 'Day view' },
            { keys: ['W'], description: 'Week view' },
            { keys: ['M'], description: 'Month view' },
          ],
        },
      ],
    },
    {
      id: 'monitoring',
      title: 'Monitoring & Logs',
      icon: Activity,
      description: 'System health and activity tracking',
      items: [
        {
          title: 'System Monitoring',
          description: 'Monitor the health of data sources and integrations.',
          features: [
            'API health status indicators',
            'Data sync monitoring',
            'Response time tracking',
            'Error rate visualization',
            'Uptime statistics',
          ],
        },
        {
          title: 'Error Logs',
          description: 'View and troubleshoot system errors.',
          features: [
            'Error categorization',
            'Stack trace details',
            'Timestamp and frequency',
            'Resolution status tracking',
            'Export for support',
          ],
        },
        {
          title: 'Activity Logs',
          description: 'Track user actions and system events.',
          features: [
            'User action history',
            'Entity change tracking',
            'Login/logout events',
            'Report generation history',
            'Filtering by user, action, or date',
          ],
        },
        {
          title: 'Quality Assurance',
          description: 'Monitor data quality across the system.',
          features: [
            'Data completeness scoring',
            'Validation error tracking',
            'Missing field identification',
            'Quality trend analysis',
            'Improvement recommendations',
          ],
        },
      ],
    },
    {
      id: 'admin',
      title: 'Administration',
      icon: UserCog,
      description: 'User management and system settings',
      items: [
        {
          title: 'User Management',
          description: 'Manage team members and their access levels.',
          features: [
            'User creation and deactivation',
            'Role assignment (Admin, User, Viewer)',
            'Password management',
            'Email configuration',
            'Personal mailbox settings',
          ],
        },
        {
          title: 'Integrations',
          description: 'Configure external service connections.',
          features: [
            'GoHighLevel (GHL) CRM integration',
            'Email provider settings',
            'API key management',
            'Webhook configuration',
            'Sync status monitoring',
          ],
        },
        {
          title: 'System Settings',
          description: 'Configure global application settings.',
          features: [
            'Default values and assumptions',
            'Notification preferences',
            'Data retention policies',
            'Export/backup options',
            'Theme and display settings',
          ],
        },
      ],
    },
    {
      id: 'deal-pipeline',
      title: 'Deal Pipeline',
      icon: Briefcase,
      description: 'Track property deals from inquiry to settlement',
      items: [
        {
          title: 'Pipeline Overview',
          description: 'The Deal Pipeline provides a Kanban-style board to track every property deal through its lifecycle stages.',
          features: [
            'Kanban board with drag-and-drop stage progression',
            'Deal stages: Lead, Qualified, Proposal, Negotiation, Under Contract, Settlement, Completed',
            'Deal value and commission tracking',
            'Client and property linking',
            'Assigned team member per deal',
            'Build progress payment tracking for construction deals',
          ],
          steps: [
            'Navigate to "Deal Pipeline" in the sidebar',
            'Click "Add Deal" to create a new deal',
            'Link the deal to a client and property',
            'Drag deals between stages as they progress',
            'Track commissions and builder invoices within each deal',
          ],
        },
        {
          title: 'Build Progress Payments',
          description: 'Track construction stage payments and builder invoices for build deals.',
          features: [
            'Stage-by-stage payment tracking (Slab, Frame, Lock-up, etc.)',
            'Builder invoice receipt and submission tracking',
            'Funds released and paid-to-builder status',
            'Commission trigger identification per stage',
            'Lender submission tracking',
          ],
        },
      ],
    },
    {
      id: 'agreements',
      title: 'Agency Agreements',
      icon: FileText,
      description: 'Generate, send, and manage buyer agency agreements',
      items: [
        {
          title: 'Agreement Generation',
          description: 'Create professional agency agreements from templates linked to your clients and deals.',
          features: [
            'Template-based agreement generation',
            'Auto-populated buyer details from client records',
            'Custom commitment fee and terms',
            'Secondary buyer support',
            'PDF generation and storage',
          ],
          steps: [
            'Navigate to "Agreements" in the sidebar',
            'Click "New Agreement" to start',
            'Select a client and optionally link a deal',
            'Fill in buyer details, fees, and notes',
            'Generate and review the PDF',
            'Send via DocuSign for electronic signature',
          ],
        },
        {
          title: 'DocuSign Integration',
          description: 'Send agreements for electronic signature via DocuSign.',
          features: [
            'One-click DocuSign envelope creation',
            'Real-time signing status tracking',
            'Automatic status sync (Sent, Delivered, Signed, Voided)',
            'Signed PDF retrieval and storage',
          ],
        },
      ],
    },
    {
      id: 'checklists',
      title: 'Checklists',
      icon: CheckCircle,
      description: 'Manage process checklists from templates',
      items: [
        {
          title: 'Checklist Templates',
          description: 'Create reusable checklist templates for standardized processes like onboarding, settlement, or compliance.',
          features: [
            'Multi-section checklist templates',
            'Custom item ordering and section grouping',
            'Icon assignment per section',
            'Template activation/deactivation',
            'Cron-based auto-generation scheduling',
          ],
        },
        {
          title: 'Checklist Instances',
          description: 'Generate and work through checklist instances from templates.',
          features: [
            'Progress percentage tracking',
            'Checked-by user and timestamp logging',
            'Status tracking (In Progress, Completed)',
            'AI-powered checklist generation',
          ],
          steps: [
            'Navigate to "Checklists" in the sidebar',
            'Select a template or create a new instance',
            'Work through items by checking them off',
            'Track overall progress in the dashboard',
          ],
        },
      ],
    },
    {
      id: 'marketing-analytics',
      title: 'Marketing Analytics',
      icon: TrendingUp,
      description: 'Track marketing campaigns, leads, and conversion metrics',
      items: [
        {
          title: 'Campaign Tracking',
          description: 'Monitor the performance of your marketing campaigns across channels.',
          features: [
            'UTM parameter tracking for leads',
            'Meta/Facebook ad attribution',
            'Lead source identification',
            'Campaign-level conversion rates',
            'Cost-per-lead analysis',
          ],
        },
        {
          title: 'Lead Management',
          description: 'View and manage incoming leads from marketing campaigns.',
          features: [
            'Real-time lead notifications',
            'Lead-to-client conversion tracking',
            'Source attribution (Google, Meta, Organic, Referral)',
            'Lead scoring and prioritization',
          ],
        },
      ],
    },
    {
      id: 'reminders',
      title: 'Reminders Hub',
      icon: Clock,
      description: 'Centralized view of all reminders and follow-ups',
      items: [
        {
          title: 'Reminders Dashboard',
          description: 'A centralized hub showing all upcoming, overdue, and completed reminders across all clients.',
          features: [
            'Today, upcoming, and overdue reminder filters',
            'Priority-based sorting (Urgent, High, Normal, Low)',
            'Client-linked reminders with quick navigation',
            'Snooze and complete actions',
            'Bell notification integration for upcoming reminders',
          ],
          tips: [
            'Check the Reminders Hub daily to stay on top of follow-ups',
            'Set high-priority reminders for time-sensitive items',
            'Upcoming reminders trigger bell notifications the day before',
          ],
        },
      ],
    },
    {
      id: 'report-requests',
      title: 'Report Requests',
      icon: FileSpreadsheet,
      description: 'Manage report requests from the client portal',
      items: [
        {
          title: 'Incoming Requests',
          description: 'View and process report requests submitted by clients through the client portal.',
          features: [
            'Real-time notifications when a client submits a request',
            'Request status tracking (Pending, In Progress, Completed, Declined)',
            'Property address and client details',
            'Notes and comments per request',
            'Direct report generation from requests',
          ],
          steps: [
            'Navigate to "Report Requests" in the sidebar',
            'Review pending requests from clients',
            'Accept a request and generate the report',
            'Update the status as you work on it',
            'Client receives automatic email notification on completion',
          ],
        },
      ],
    },
    {
      id: 'client-portal',
      title: 'Client Portal',
      icon: LayoutDashboard,
      description: 'Self-service portal for your clients',
      items: [
        {
          title: 'Portal Overview',
          description: 'The Client Portal allows your clients to log in, view their reports, request new reports, and book appointments.',
          features: [
            'Secure client login with magic links or passwords',
            'Personalized dashboard per client',
            'Report viewing and download',
            'New report request submission',
            'Appointment booking',
            'In-app notification feed',
          ],
        },
        {
          title: 'Client Portal',
          description: 'Configure branding and settings for the client-facing portal.',
          features: [
            'Custom branding and logos',
            'Enable/disable portal features',
            'Booking calendar configuration',
            'Welcome message customization',
            'Auto-email notifications for portal events',
          ],
          steps: [
            'Navigate to "Client Portal" in the sidebar',
            'Configure branding, colors, and logos',
            'Enable the features you want clients to access',
            'Test the portal by logging in as a client',
          ],
        },
      ],
    },
    {
      id: 'ai-agent',
      title: 'AI Agent',
      icon: Bot,
      description: 'Conversational AI assistant with tool-calling capabilities',
      items: [
        {
          title: 'Agent Overview',
          description: 'The AI Agent is an advanced conversational assistant that can perform actions on your behalf such as looking up clients, creating reminders, and running analyses.',
          features: [
            'Natural language commands for dashboard actions',
            'Tool-calling: search clients, create reminders, query data',
            'Conversation history with pinning and sharing',
            'Playbooks for multi-step automated workflows',
            'Scheduled tasks for recurring agent actions',
            'Action audit log with rollback capability',
          ],
        },
        {
          title: 'Playbooks & Scheduling',
          description: 'Automate multi-step workflows and schedule recurring AI agent tasks.',
          features: [
            'Create reusable playbooks with ordered steps',
            'Schedule tasks with cron expressions',
            'Run history and status tracking',
            'Enable/disable individual scheduled tasks',
          ],
        },
      ],
    },
    {
      id: 'notifications',
      title: 'Notifications',
      icon: Bell,
      description: 'Real-time alerts and notification management',
      items: [
        {
          title: 'Notification Center',
          description: 'The bell icon in the top navigation provides real-time alerts for important events across the platform.',
          features: [
            'Real-time push notifications for reports, emails, calls, and bookings',
            'Click-to-navigate to the relevant page',
            'Mark as read / mark all as read',
            'Notification persistence across sessions',
          ],
        },
        {
          title: 'Notification Sources',
          description: 'Events that trigger internal dashboard notifications.',
          features: [
            'Investment report generation completed or failed',
            'Incoming emails (admin and personal mailboxes)',
            'VAPI call completions with outcome details',
            'Appointment bookings from GHL, Outlook, or dashboard',
            'New GHL contacts synced',
            'Marketing leads with campaign attribution',
            'Client portal report requests',
            'Agency agreement generation',
            'Client reminders due today or upcoming',
          ],
        },
      ],
    },
    {
      id: 'api-usage',
      title: 'API Usage & Costs',
      icon: PieChart,
      description: 'Monitor AI token usage and API costs',
      items: [
        {
          title: 'Usage Dashboard',
          description: 'Track API consumption across all AI-powered features to manage costs.',
          features: [
            'Token usage breakdown by service (OpenAI, Gemini, etc.)',
            'Cost estimation in USD',
            'Usage trends over time',
            'Per-user consumption tracking',
            'Model-level breakdown',
          ],
          tips: [
            'Monitor usage regularly to stay within budget',
            'Review which features consume the most tokens',
            'Use efficient analysis modes to reduce costs',
          ],
        },
      ],
    },
    // Sections defined as data in `lib/userGuideSections.ts`. They live there
    // rather than inline because the AI knowledge base needs the same content,
    // and two hand-maintained copies is exactly how this guide fell behind the
    // app in the first place.
    ...ADDITIONAL_GUIDE_SECTIONS.map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description,
      icon: GUIDE_SECTION_ICONS[section.icon] ?? BookOpen,
      items: section.items,
    })),
  ];

  // Only the sections this workspace is entitled to. A Launch clone must not
  // be reading the Finance Portal guide: following a walkthrough for a screen
  // that is not in the sidebar reads as a broken product, not a locked one.
  //
  // An unknown or still-loading plan shows everything — the same asymmetry
  // planEntitlements.ts takes. Showing a section someone cannot use is an
  // annoyance; hiding one they pay for is a fault.
  const entitlementCtx = { planSlug: planLoading ? null : planSlug, addonSlugs };
  const sections = useMemo(
    () => filterEntitledSections(allSections, entitlementCtx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planSlug, addonSlugs, planLoading],
  );
  const locked = useMemo(
    () => lockedSections(allSections, entitlementCtx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planSlug, addonSlugs, planLoading],
  );

  const quickTips = [
    { icon: Search, text: 'Use ⌘/Ctrl + K to quickly search across the application' },
    { icon: Filter, text: 'Combine multiple filters for precise property and client searches' },
    { icon: Download, text: 'Download reports in PDF format for offline viewing and sharing' },
    { icon: Eye, text: 'Click on any property card to view detailed information and generate reports' },
    { icon: Target, text: 'Use the Overview dashboard for a quick snapshot of portfolio performance' },
    { icon: Bot, text: 'Ask the Aurixa Intelligence Hub AI natural language questions about your properties' },
  ];

  const statusGuide = [
    { status: 'Active', color: 'bg-success', description: 'Property is currently listed and available' },
    { status: 'Pending', color: 'bg-brand-500', description: 'Property has an offer pending or under contract' },
    { status: 'Sold', color: 'bg-info', description: 'Property has been successfully sold' },
    { status: 'Withdrawn', color: 'bg-muted0', description: 'Property has been removed from the market' },
    { status: 'Expired', color: 'bg-destructive', description: 'Listing has expired and needs renewal' },
  ];

  const quickTipCardClasses = [
    'border-primary/25 bg-[linear-gradient(135deg,hsl(var(--primary)/0.12),hsl(var(--card)/0.92))] shadow-primary/5',
    'border-brand-400/25 bg-[linear-gradient(135deg,rgba(245,158,11,0.12),hsl(var(--card)/0.92))] shadow-brand-500/5',
    'border-info/25 bg-[linear-gradient(135deg,rgba(59,130,246,0.10),hsl(var(--card)/0.92))] shadow-info/5',
    'border-success/25 bg-[linear-gradient(135deg,rgba(16,185,129,0.10),hsl(var(--card)/0.92))] shadow-success/5',
    'border-accent/25 bg-[linear-gradient(135deg,rgba(168,85,247,0.10),hsl(var(--card)/0.92))] shadow-accent/5',
    'border-info/25 bg-[linear-gradient(135deg,rgba(6,182,212,0.10),hsl(var(--card)/0.92))] shadow-info/5',
  ];

  const statusGuideStyles = {
    Active: {
      card: 'border-success/25 bg-success/8 shadow-success/5',
      badge: 'border-success/35 bg-success/10 text-success dark:text-success',
      ring: 'ring-success/20',
    },
    Pending: {
      card: 'border-brand-400/30 bg-brand-500/10 shadow-brand-500/5',
      badge: 'border-brand-500/40 bg-brand-500/12 text-brand-700 dark:text-brand-300',
      ring: 'ring-brand-500/25',
    },
    Sold: {
      card: 'border-info/25 bg-info/8 shadow-info/5',
      badge: 'border-info/35 bg-info/10 text-info dark:text-info',
      ring: 'ring-info/20',
    },
    Withdrawn: {
      card: 'border-muted-foreground/20 bg-muted/30 shadow-black/0',
      badge: 'border-muted-foreground/25 bg-muted/45 text-muted-foreground',
      ring: 'ring-muted-foreground/15',
    },
    Expired: {
      card: 'border-destructive/25 bg-destructive/8 shadow-destructive/5',
      badge: 'border-destructive/35 bg-destructive/10 text-destructive dark:text-destructive',
      ring: 'ring-destructive/20',
    },
  } as const;

  const [documentationSearch, setDocumentationSearch] = useState('');

  const normalizedDocumentationSearch = documentationSearch.trim().toLowerCase();

  const documentationSearchResults = useMemo(() => {
    if (!normalizedDocumentationSearch) {
      return [];
    }

    return sections.filter((section) => {
      const searchableText = [
        section.title,
        section.description,
        ...section.items.flatMap((item) => [
          item.title,
          item.description,
          ...(item.features ?? []),
          ...(item.steps ?? []),
          ...(item.tips ?? []),
          ...(item.shortcuts?.flatMap((shortcut) => [shortcut.description, ...shortcut.keys]) ?? []),
        ]),
      ]
        .join(' ')
        .toLowerCase();

      return searchableText.includes(normalizedDocumentationSearch);
    });
  }, [normalizedDocumentationSearch, sections]);

  const quickNavigationItems = [
    { label: 'Quick Tips', targetId: 'quick-tips' },
    { label: 'Property Status Guide', targetId: 'property-status-guide' },
    { label: 'Feature Documentation', targetId: 'feature-documentation' },
    { label: 'Getting Started', sectionId: 'getting-started' },
    { label: 'Client Management', sectionId: 'client-management' },
    { label: 'Aurixa Intelligence Hub', sectionId: 'report-qa' },
    { label: 'Settings', sectionId: 'settings' },
    { label: 'Need Help', targetId: 'need-help' },
    { label: 'Troubleshooting', sectionId: 'troubleshooting' },
    { label: 'Monitoring & Logs', sectionId: 'monitoring' },
    { label: 'Keyboard Shortcuts', sectionId: 'keyboard-shortcuts' },
    { label: 'API Usage & Costs', sectionId: 'api-usage' },
    { label: 'Notifications', sectionId: 'notifications' },
  ];

  const needHelpItems = [
    {
      icon: Settings,
      text: 'Check the Settings page for configuration options',
      className: 'border-brand-400/25 bg-brand-500/8 text-brand-600 dark:text-brand-300',
    },
    {
      icon: Bot,
      text: 'Use the Aurixa Intelligence Hub AI to ask questions about features',
      className: 'border-primary/25 bg-primary/10 text-primary',
    },
    {
      icon: AlertCircle,
      text: 'Review Error Logs for troubleshooting system issues',
      className: 'border-destructive/25 bg-destructive/8 text-destructive dark:text-destructive',
    },
    {
      icon: Headphones,
      text: 'Contact your system administrator for technical support',
      className: 'border-brand-400/25 bg-brand-500/8 text-brand-600 dark:text-brand-300',
    },
  ];

  const handleQuickNavigation = useCallback((item: { targetId?: string; sectionId?: string }) => {
    if (item.sectionId) {
      handleNavigateToSection(item.sectionId);
      return;
    }

    if (item.targetId) {
      document.getElementById(item.targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [handleNavigateToSection]);

  return (
    <>
    <UserGuideAssistant onNavigateToSection={handleNavigateToSection} />
    <DashboardThemeFrame
      as="main"
      variant="page"
      className="min-h-0 space-y-6 overflow-x-hidden rounded-[2rem] border border-border/50 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.10),transparent_32%),linear-gradient(180deg,hsl(var(--background)/0.96),hsl(var(--card)/0.76)_48%,hsl(var(--background)/0.98))] p-3 pb-8 text-foreground shadow-[0_28px_90px_rgba(15,23,42,0.10)] selection:bg-primary/20 selection:text-foreground [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.14),transparent_32%),linear-gradient(180deg,hsl(0_0%_2%),hsl(0_0%_6%)_50%,hsl(0_0%_3%))] dark:shadow-black/35 sm:space-y-7 sm:p-5 lg:p-6"
    >
      <DashboardThemeFrame
        as="header"
        variant="hero"
        className="border-primary/25 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.18),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.88)_52%,hsl(var(--muted)/0.42))] shadow-[0_22px_70px_rgba(15,23,42,0.10)] dark:shadow-black/30"
      >
        <div className="relative z-10 flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-inner shadow-primary/10 sm:h-14 sm:w-14">
              <FolderOpen className="h-6 w-6 sm:h-7 sm:w-7" />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="min-w-0 space-y-2">
                <h1 className="break-words text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">User Guide</h1>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Complete guide to navigating and using your dashboard
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <LiveModelBadge agentKey="user_guide_assistant" size="sm" showSlot />
                  <ModelUpgradeButton agentKey="user_guide_assistant" />
                </div>
              </div>

            </div>
          </div>
        </div>
      </DashboardThemeFrame>

      <DashboardThemeFrame
        as="section"
        variant="toolbar"
        role="navigation"
        aria-label="User Guide quick navigation"
        className="min-h-0 gap-2 overflow-x-auto overscroll-x-contain border-primary/15 bg-card/70 p-2 shadow-[0_12px_34px_rgba(15,23,42,0.06)] [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] dark:bg-background/55"
      >
        {quickNavigationItems.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => handleQuickNavigation(item)}
            className="min-h-10 min-w-max rounded-full border border-border/70 bg-background/85 px-3.5 py-2 text-xs font-medium text-muted-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/10 hover:text-foreground hover:shadow-[0_10px_28px_hsl(var(--primary)/0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:bg-background/55"
          >
            {item.label}
          </button>
        ))}
      </DashboardThemeFrame>

      {/* Quick Tips */}
      <Card id="quick-tips" className="min-w-0 scroll-mt-6 overflow-hidden rounded-[1.5rem] border-primary/15 bg-card/95 shadow-[0_18px_55px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-background/75 dark:shadow-black/25">
        <CardHeader className="space-y-2 border-b border-border/50 bg-[linear-gradient(135deg,hsl(var(--primary)/0.08),hsl(var(--muted)/0.18))]">
          <CardTitle className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 shadow-inner shadow-primary/10">
              <CheckCircle className="h-5 w-5 text-primary" />
            </span>
            <span className="min-w-0">Quick Tips</span>
          </CardTitle>
          <CardDescription className="leading-6">
            Essential tips to get the most out of your dashboard
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {quickTips.map((tip, index) => (
              <div
                key={index}
                className={`group relative min-w-0 overflow-hidden rounded-2xl border p-4 shadow-lg transition-all duration-300 before:absolute before:inset-y-4 before:left-0 before:w-1 before:rounded-r-full before:bg-primary/65 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_20px_48px_rgba(15,23,42,0.12),0_0_0_1px_hsl(var(--primary)/0.10)] dark:hover:shadow-black/35 ${quickTipCardClasses[index]}`}
              >
                <div className="relative z-10 flex min-w-0 items-start gap-3">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-background/85 text-primary shadow-sm shadow-primary/5 transition-transform duration-300 group-hover:scale-105 dark:bg-background/55">
                    <tip.icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 space-y-2">
                    <span className="block min-w-0 text-sm font-medium leading-6 text-foreground/95">{tip.text}</span>
                    {index === 0 && (
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <kbd className="rounded-md border border-border bg-background px-2 py-1 font-semibold text-foreground shadow-sm">⌘/Ctrl</kbd>
                        <span>+</span>
                        <kbd className="rounded-md border border-border bg-background px-2 py-1 font-semibold text-foreground shadow-sm">K</kbd>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Property Status Guide */}
      <Card id="property-status-guide" className="min-w-0 scroll-mt-6 overflow-hidden rounded-[1.5rem] border-primary/15 bg-card/95 shadow-[0_18px_55px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-background/75 dark:shadow-black/25">
        <CardHeader className="space-y-2 border-b border-border/50 bg-[linear-gradient(135deg,hsl(var(--primary)/0.06),hsl(var(--muted)/0.16))]">
          <CardTitle className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-info/20 bg-info/10 shadow-inner shadow-info/10">
              <AlertCircle className="h-5 w-5 text-info-foreground0" />
            </span>
            <span className="min-w-0">Property Status Guide</span>
          </CardTitle>
          <CardDescription className="leading-6">
            Understanding property status indicators throughout the dashboard
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {statusGuide.map((item, index) => {
              const style = statusGuideStyles[item.status as keyof typeof statusGuideStyles];

              return (
                <div
                  key={index}
                  aria-label={`${item.status}: ${item.description}`}
                  className={`flex min-w-0 flex-col gap-3 rounded-2xl border p-4 shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_18px_44px_rgba(15,23,42,0.10),0_0_0_1px_hsl(var(--primary)/0.08)] dark:hover:shadow-black/30 ${style.card}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl bg-background/75 ring-4 dark:bg-background/50 ${style.ring}`}>
                      <span className={`h-3.5 w-3.5 rounded-full shadow-sm ${item.color}`} />
                    </span>
                    <Badge variant="outline" className={`min-w-0 rounded-full px-3 py-1 text-xs font-semibold shadow-sm ${style.badge}`}>
                      {item.status}
                    </Badge>
                  </div>
                  <span className="min-w-0 text-sm leading-6 text-muted-foreground">{item.description}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Main Sections with Accordion */}
      <Card id="feature-documentation" className="min-w-0 scroll-mt-6 overflow-hidden rounded-[1.5rem] border-primary/15 bg-card/95 shadow-[0_18px_55px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-background/75 dark:shadow-black/25">
        <CardHeader className="space-y-4 border-b border-border/50 bg-[linear-gradient(135deg,hsl(var(--primary)/0.08),hsl(var(--muted)/0.16))]">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-2">
              <CardTitle className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 shadow-inner shadow-primary/10">
                  <FileText className="h-5 w-5 text-primary" />
                </span>
                <span className="min-w-0">Feature Documentation</span>
              </CardTitle>
              <CardDescription className="leading-6">
                Click on any section to expand and view detailed documentation
              </CardDescription>
            </div>
            <Badge variant="outline" className="w-fit rounded-full border-primary/30 bg-primary/10 px-3 py-1 text-primary shadow-sm shadow-primary/10">
              {sections.length} sections
            </Badge>
          </div>

          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <label className="relative min-w-0">
              <span className="sr-only">Search feature documentation</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                aria-label="Search feature documentation"
                value={documentationSearch}
                onChange={(event) => setDocumentationSearch(event.target.value)}
                placeholder="Search feature documentation"
                className="h-11 w-full min-w-0 rounded-2xl border border-border/75 bg-background/90 pl-10 pr-10 text-sm text-foreground shadow-inner outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/45 focus:ring-2 focus:ring-primary/25 dark:bg-background/60"
              />
              {documentationSearch && (
                <button
                  type="button"
                  onClick={() => setDocumentationSearch('')}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                  aria-label="Clear feature documentation search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </label>
            <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border/60 bg-background/60 px-3 py-2 text-xs text-muted-foreground dark:bg-background/40">
              <span>Full documentation list stays visible while search shows jump results.</span>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => openDocumentation()}
              >
                <BookOpen className="h-4 w-4" />
                Read full documentation
                <ExternalLink className="h-3.5 w-3.5 opacity-70" />
              </Button>
            </div>
          </div>

          {normalizedDocumentationSearch && (
            <div className="rounded-2xl border border-border/60 bg-background/60 p-3 dark:bg-background/45">
              {documentationSearchResults.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Matching sections
                  </div>
                  <div className="flex min-w-0 flex-wrap gap-2">
                    {documentationSearchResults.map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => handleNavigateToSection(section.id)}
                        className="min-h-9 max-w-full rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                      >
                        {section.title}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-brand-500/20 bg-brand-500/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-brand-500/25 bg-brand-500/10 text-brand-600 dark:text-brand-300">
                      <Search className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 break-words text-sm leading-6 text-muted-foreground">
                      No documentation sections match “{documentationSearch}”.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDocumentationSearch('')}
                    className="min-h-9 w-fit rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/35 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                  >
                    Clear search
                  </button>
                </div>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="min-h-0 bg-muted/10 p-3 sm:p-4">
          {sections.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-background/70 p-6 text-center shadow-sm dark:bg-background/40">
              <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm leading-6 text-muted-foreground">No documentation sections are available.</p>
            </div>
          ) : (
          <Accordion type="multiple" className="grid min-w-0 w-full gap-3">
            {sections.map((section) => (
              <AccordionItem id={`section-${section.id}`} key={section.id} value={section.id} className="group/section scroll-mt-6 overflow-hidden rounded-2xl border border-border/65 bg-card/90 px-0 shadow-sm transition-all duration-200 hover:border-primary/25 hover:shadow-[0_12px_32px_rgba(15,23,42,0.08)] data-[state=open]:border-primary/35 data-[state=open]:shadow-[0_18px_48px_rgba(15,23,42,0.10),0_0_0_1px_hsl(var(--primary)/0.08)] dark:bg-background/60 dark:hover:shadow-black/20 dark:data-[state=open]:shadow-black/30">
                <AccordionTrigger className="min-w-0 px-4 py-4 text-left transition-colors hover:bg-primary/5 hover:no-underline focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:bg-primary/10 sm:min-h-16 sm:px-5 [&>svg]:ml-3 [&>svg]:flex-shrink-0 [&>svg]:text-primary [&>svg]:transition-transform [&>svg]:duration-200">
                  <div className="flex min-w-0 items-center gap-3 pr-2">
                    <div className="flex-shrink-0 rounded-xl border border-primary/15 bg-primary/10 p-2 transition-colors group-data-[state=open]/section:border-primary/30 group-data-[state=open]/section:bg-primary/15">
                      <section.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 text-left">
                      <div className="break-words font-semibold text-foreground">{section.title}</div>
                      <div className="break-words text-sm font-normal leading-6 text-muted-foreground">
                        {section.description}
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
                  <div className="min-h-0 min-w-0 border-t border-border/50 bg-background/45 px-3 py-5 sm:px-5">
                    {/* The guide is the quick reference; the documentation site
                        carries the long form. It is gated by the same plan and
                        add-on entitlement as this page, so a section visible
                        here is always readable there. */}
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3">
                      <p className="min-w-0 text-sm leading-6 text-muted-foreground">
                        Want the full detail on {section.title}?
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-shrink-0 gap-2"
                        onClick={() => openDocumentation(section.id)}
                      >
                        <BookOpen className="h-4 w-4" />
                        Read documentation
                        <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                      </Button>
                    </div>
                    <div className="ml-2 min-w-0 space-y-5 border-l-2 border-primary/25 pl-3 sm:ml-5 sm:pl-6">
                    {section.items.map((item, itemIndex) => (
                      <article
                        key={itemIndex}
                        className="min-w-0 overflow-hidden rounded-2xl border border-border/65 bg-card/95 shadow-[0_12px_34px_rgba(15,23,42,0.06)] ring-1 ring-white/60 dark:border-white/10 dark:bg-background/50 dark:ring-white/5"
                      >
                        <div className="flex min-w-0 items-start gap-3 border-b border-border/50 bg-[linear-gradient(135deg,hsl(var(--primary)/0.075),transparent_58%)] p-4 sm:p-5">
                          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-xs font-semibold text-primary shadow-inner shadow-primary/10">
                            {itemIndex + 1}
                          </span>
                          <div className="min-w-0 space-y-1.5">
                            <h4 className="break-words text-base font-semibold leading-6 text-foreground">{item.title}</h4>
                            <p className="text-sm leading-7 text-muted-foreground">{item.description}</p>
                          </div>
                        </div>

                        <div className="min-w-0 space-y-4 p-4 sm:p-5">
                        {item.features && (
                          <div className="min-w-0 space-y-3 rounded-2xl border border-success/15 bg-success/5 p-4">
                            <h5 className="text-sm font-semibold leading-6 text-foreground">Key Features:</h5>
                            <ul className="grid min-w-0 gap-2 sm:grid-cols-2">
                              {item.features.map((feature, featureIndex) => (
                                <li key={featureIndex} className="flex min-w-0 items-start gap-2.5 rounded-xl bg-background/55 p-2.5 text-sm leading-6 text-foreground/90 dark:bg-background/35">
                                  <CheckCircle className="mt-1 h-4 w-4 flex-shrink-0 text-success-foreground0" />
                                  <span className="min-w-0 break-words">{feature}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {item.steps && (
                          <div className="min-w-0 space-y-3 rounded-2xl border border-primary/15 bg-primary/5 p-4">
                            <h5 className="text-sm font-semibold leading-6 text-foreground">Step-by-Step Guide:</h5>
                            <ol className="space-y-2.5">
                              {item.steps.map((step, stepIndex) => (
                                <li key={stepIndex} className="flex min-w-0 items-start gap-3 rounded-xl bg-background/60 p-3 text-sm dark:bg-background/35">
                                  <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/25">
                                    {stepIndex + 1}
                                  </span>
                                  <span className="min-w-0 break-words leading-7 text-foreground/90">{step}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}

                        {item.tips && (
                          <div className="min-w-0 space-y-3 rounded-2xl border border-brand-500/15 bg-brand-500/5 p-4">
                            <h5 className="text-sm font-semibold leading-6 text-foreground">Tips:</h5>
                            <ul className="space-y-2">
                              {item.tips.map((tip, tipIndex) => (
                                <li key={tipIndex} className="flex min-w-0 items-start gap-2.5 rounded-xl bg-background/55 p-2.5 text-sm leading-6 dark:bg-background/35">
                                  <Sparkles className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-brand-500" />
                                  <span className="min-w-0 break-words text-foreground/90">{tip}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {item.shortcuts && (
                          <div className="min-w-0 space-y-3 rounded-2xl border border-border/55 bg-muted/20 p-4">
                            <h5 className="text-sm font-semibold leading-6 text-foreground">Shortcuts:</h5>
                            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                              {item.shortcuts.map((shortcut, shortcutIndex) => (
                                <div
                                  key={shortcutIndex}
                                  className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-background/65 p-3 dark:bg-background/35"
                                >
                                  <span className="min-w-0 break-words text-sm leading-6 text-muted-foreground">
                                    {shortcut.description}
                                  </span>
                                  <div className="flex flex-shrink-0 flex-wrap gap-1">
                                    {shortcut.keys.map((key, keyIndex) => (
                                      <kbd
                                        key={keyIndex}
                                        className="rounded-lg border border-primary/20 bg-background px-2.5 py-1 text-xs font-semibold text-foreground shadow-sm shadow-primary/5 ring-1 ring-white/50 dark:bg-background/60 dark:ring-white/10"
                                      >
                                        {key}
                                      </kbd>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        </div>

                        {itemIndex < section.items.length - 1 && <Separator className="mx-5" />}
                      </article>
                    ))}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          )}
          {/* Guides this plan does not include.
              Named rather than silently omitted: a customer who notices a
              feature exists is a sales conversation, whereas a customer who
              notices documentation vanished raises a support ticket. */}
          {locked.length > 0 && (
            <div className="mt-6 rounded-2xl border border-border/65 bg-muted/25 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
                  <Lock className="h-4 w-4" />
                </span>
                <div className="min-w-0 space-y-2">
                  <h4 className="text-sm font-semibold leading-6 text-foreground">
                    {locked.length} more {locked.length === 1 ? 'guide' : 'guides'} available on
                    other plans
                  </h4>
                  <p className="text-sm leading-6 text-muted-foreground">
                    These cover modules your current plan does not include. Contact your
                    administrator to add them.
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {locked.map((l) => (
                      <span
                        key={l.id}
                        className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground"
                      >
                        {l.title}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Support Section */}
      <Card id="need-help" className="min-w-0 scroll-mt-6 overflow-hidden rounded-[1.5rem] border-primary/20 bg-card/90 shadow-[0_18px_55px_rgba(15,23,42,0.08)] dark:border-primary/15 dark:bg-background/75 dark:shadow-black/25">
        <CardHeader className="space-y-2 border-b border-border/50 bg-[linear-gradient(135deg,hsl(var(--primary)/0.10),hsl(var(--muted)/0.16))]">
          <CardTitle className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 shadow-inner shadow-primary/10">
              <Headphones className="h-5 w-5 text-primary" />
            </span>
            <span className="min-w-0">Need Help?</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <p className="text-sm leading-6 text-muted-foreground">
            If you need additional assistance or encounter any issues:
          </p>
          <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
            {needHelpItems.map((item) => (
              <li
                key={item.text}
                className="group flex min-w-0 items-start gap-3 rounded-2xl border border-border/65 bg-background/80 p-4 text-sm shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/5 hover:shadow-[0_14px_34px_rgba(15,23,42,0.08),0_0_0_1px_hsl(var(--primary)/0.08)] dark:bg-background/40 dark:hover:shadow-black/25"
              >
                <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border shadow-inner ${item.className}`}>
                  <item.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 break-words leading-6 text-foreground/90">{item.text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </DashboardThemeFrame>
    </>
  );
}
