import { TabsList, TabsTrigger } from '@/components/ui/tabs';
export type AdvancedTab = 'branding'|'fact-find'|'expenses'|'output';
const ADVANCED_TABS: {value:AdvancedTab;label:string}[]=[{value:'branding',label:'White Label Setup'},{value:'fact-find',label:'Client Fact Find'},{value:'expenses',label:'Living Expenses'},{value:'output',label:'Client Form Output'}];
export function AdvancedTabNavigation(){return <div className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6"><TabsList aria-label="Advanced client form sections" className="grid w-full grid-cols-1 gap-1 bg-muted/60 sm:grid-cols-4">{ADVANCED_TABS.map(tab=><TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>)}</TabsList></div>}
