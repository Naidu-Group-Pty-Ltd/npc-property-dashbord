import { useState, useCallback, useRef, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Calculator, Info, Percent, DollarSign, TrendingUp, ChevronDown, ChevronRight, Home, Banknote, Building, MapPin, Check, Download } from 'lucide-react';
import { formatNumberWithCommas, removeCommas } from '@/hooks/useFormattedNumber';
import { MortgageRepaymentCalculator } from '../MortgageRepaymentCalculator';
import { useToast } from '@/hooks/use-toast';
import { LoanType, RepaymentFrequency } from '@/utils/mortgageCalculations';
import { BuildType } from '@/types/overrideFields';

export type StampDutyPropertyType = 'primary_residence' | 'investment';
export type StampDutyPurchaseType = 'established_home' | 'new_home' | 'vacant_land';

interface FinancialsTabProps {
  buildType: BuildType;
  purchasePrice: string;
  depositValue: string;
  setDepositValue: (value: string) => void;
  loanToValueRatio: string;
  setLoanToValueRatio: (value: string) => void;
  interestRate: string;
  setInterestRate: (value: string) => void;
  loanTermYears: string;
  setLoanTermYears: (value: string) => void;
  loanType: 'interest_only' | 'principal_interest';
  setLoanType: (value: 'interest_only' | 'principal_interest') => void;
  capitalGrowth: string;
  setCapitalGrowth: (value: string) => void;
  stampDuty: string;
  setStampDuty: (value: string) => void;
  solicitorFees: string;
  setSolicitorFees: (value: string) => void;
  agentFee: string;
  setAgentFee: (value: string) => void;
  isFirstHomeBuyer: boolean;
  setIsFirstHomeBuyer: (value: boolean) => void;
  detectedState: string;
  propertyAddress: string;
  disabled?: boolean;
  stampDutyPropertyType?: StampDutyPropertyType;
  setStampDutyPropertyType?: (value: StampDutyPropertyType) => void;
  stampDutyPurchaseType?: StampDutyPurchaseType;
  setStampDutyPurchaseType?: (value: StampDutyPurchaseType) => void;
  loanAmount?: string;
  setLoanAmount?: (value: string) => void;
  interestOnlyPeriodYears?: string;
  setInterestOnlyPeriodYears?: (value: string) => void;
  repaymentFrequency?: 'weekly' | 'fortnightly' | 'monthly';
  setRepaymentFrequency?: (value: 'weekly' | 'fortnightly' | 'monthly') => void;
  extraRepaymentPerMonth?: string;
  setExtraRepaymentPerMonth?: (value: string) => void;
  offsetBalance?: string;
  setOffsetBalance?: (value: string) => void;
  /** Locality-derived growth estimate for smart default */
  localityGrowthEstimate?: { capitalGrowthPercent: number; source: string } | null;
}

export function FinancialsTab({
  buildType,
  purchasePrice,
  depositValue,
  setDepositValue,
  loanToValueRatio,
  setLoanToValueRatio,
  interestRate,
  setInterestRate,
  loanTermYears,
  setLoanTermYears,
  loanType,
  setLoanType,
  capitalGrowth,
  setCapitalGrowth,
  stampDuty,
  setStampDuty,
  solicitorFees,
  setSolicitorFees,
  agentFee,
  setAgentFee,
  isFirstHomeBuyer,
  setIsFirstHomeBuyer,
  detectedState,
  propertyAddress,
  disabled = false,
  stampDutyPropertyType: propStampDutyPropertyType,
  setStampDutyPropertyType: propSetStampDutyPropertyType,
  stampDutyPurchaseType: propStampDutyPurchaseType,
  setStampDutyPurchaseType: propSetStampDutyPurchaseType,
  loanAmount: propLoanAmount,
  setLoanAmount: propSetLoanAmount,
  interestOnlyPeriodYears: propInterestOnlyPeriodYears,
  setInterestOnlyPeriodYears: propSetInterestOnlyPeriodYears,
  repaymentFrequency: propRepaymentFrequency,
  setRepaymentFrequency: propSetRepaymentFrequency,
  extraRepaymentPerMonth: propExtraRepaymentPerMonth,
  setExtraRepaymentPerMonth: propSetExtraRepaymentPerMonth,
  offsetBalance: propOffsetBalance,
  setOffsetBalance: propSetOffsetBalance,
  localityGrowthEstimate
}: FinancialsTabProps) {
  const [showStampDutyModal, setShowStampDutyModal] = useState(false);
  const [showMortgageCalculator, setShowMortgageCalculator] = useState(false);
  const [localStampDutyPropertyType, setLocalStampDutyPropertyType] = useState<StampDutyPropertyType>('investment');
  const [localStampDutyPurchaseType, setLocalStampDutyPurchaseType] = useState<StampDutyPurchaseType>('established_home');
  const [manualStampDutyInput, setManualStampDutyInput] = useState<string>('');
  const [capturedStampDuty, setCapturedStampDuty] = useState<string>('');
  const [isCapturing, setIsCapturing] = useState(false);
  const stampDutyContainerRef = useRef<HTMLDivElement>(null);
  const stampDutyIframeRef = useRef<HTMLIFrameElement>(null);
  const isNewBuild = buildType === 'new_build';
  const { toast } = useToast();

  const stampDutyPropertyType = propStampDutyPropertyType ?? localStampDutyPropertyType;
  const setStampDutyPropertyType = propSetStampDutyPropertyType ?? setLocalStampDutyPropertyType;
  const stampDutyPurchaseType = propStampDutyPurchaseType ?? localStampDutyPurchaseType;
  const setStampDutyPurchaseType = propSetStampDutyPurchaseType ?? setLocalStampDutyPurchaseType;

  // Listen for messages from the stamp duty calculator iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'STAMP_DUTY_VALUE') {
        setIsCapturing(false);
        if (event.data.success && event.data.value) {
          const value = Math.round(event.data.value).toString();
          setManualStampDutyInput(value);
          setCapturedStampDuty(value);
          toast({
            title: "Value Captured",
            description: `$${formatNumberWithCommas(value)} has been captured from the calculator.`,
          });
        } else {
          toast({
            title: "Could not capture value",
            description: "Please calculate stamp duty first, then try again or enter manually.",
            variant: "destructive",
          });
        }
      } else if (event.data?.type === 'STAMP_DUTY_VALUE_AVAILABLE') {
        // Auto-update when calculator shows a new result
        if (event.data.value) {
          const value = Math.round(event.data.value).toString();
          setManualStampDutyInput(value);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [toast]);

  const handleCurrencyChange = useCallback((setter: (value: string) => void) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawValue = removeCommas(e.target.value);
      if (rawValue === '' || rawValue === '-' || /^-?\d*\.?\d*$/.test(rawValue)) {
        setter(rawValue);
      }
    };
  }, []);

  const formatForDisplay = useCallback((value: string) => {
    return formatNumberWithCommas(value);
  }, []);

  const price = parseFloat(purchasePrice) || 0;
  const lvr = parseFloat(loanToValueRatio) || 80;
  const loanAmount = Math.round(price * (lvr / 100));
  const rate = parseFloat(interestRate) || 6.5;
  const monthlyInterest = Math.round((loanAmount * (rate / 100)) / 12);

  // Handle input change for stamp duty (editable field for review/adjustment)
  const handleManualStampDutyInputChange = useCallback((value: string) => {
    const rawValue = removeCommas(value);
    setManualStampDutyInput(rawValue);
    // Also update captured value when manually edited
    if (rawValue && !isNaN(parseFloat(rawValue)) && parseFloat(rawValue) > 0) {
      setCapturedStampDuty(rawValue);
    }
  }, []);

  // Step 1: Capture the calculated value from iframe
  const handleCaptureValue = useCallback(() => {
    if (stampDutyIframeRef.current?.contentWindow) {
      setIsCapturing(true);
      stampDutyIframeRef.current.contentWindow.postMessage({ type: 'CAPTURE_STAMP_DUTY' }, '*');
      
      // Timeout fallback if no response
      setTimeout(() => {
        setIsCapturing(false);
      }, 3000);
    } else {
      toast({
        title: "Calculator not ready",
        description: "Please wait for the calculator to load.",
        variant: "destructive",
      });
    }
  }, [toast]);

  // Step 2: Use the captured value in the analysis
  const handleUseValue = useCallback(() => {
    const valueToUse = capturedStampDuty || manualStampDutyInput;
    if (valueToUse && parseFloat(valueToUse) > 0) {
      setStampDuty(valueToUse);
      toast({
        title: "Stamp Duty Applied",
        description: `$${formatNumberWithCommas(valueToUse)} has been applied to your analysis.`,
      });
      setShowStampDutyModal(false);
      setManualStampDutyInput('');
      setCapturedStampDuty('');
    }
  }, [capturedStampDuty, manualStampDutyInput, setStampDuty, toast]);

  const totalAcquisitionCosts = 
    (parseFloat(stampDuty) || 0) +
    (parseFloat(solicitorFees) || 0) +
    (!isNewBuild && agentFee ? parseFloat(agentFee) : 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Loan Structure Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Percent className="h-5 w-5 text-primary" />
              Deposit & Loan
            </h3>
            {price > 0 && (
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Loan Amount</p>
                <p className="text-lg font-bold text-primary">${loanAmount.toLocaleString()}</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="space-y-2">
              <Label htmlFor="depositValue" className="text-sm font-medium flex items-center gap-1">
                Deposit
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Auto-calculated from Purchase Price × (100% - LVR)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="depositValue"
                  type="text"
                  inputMode="numeric"
                  value={formatForDisplay(depositValue)}
                  onChange={handleCurrencyChange(setDepositValue)}
                  placeholder="Auto-calculated"
                  disabled={disabled}
                  className="pl-7 bg-muted/30"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="loanToValueRatio" className="text-sm font-medium">LVR</Label>
              <div className="relative">
                <Input
                  id="loanToValueRatio"
                  type="number"
                  value={loanToValueRatio}
                  onChange={(e) => setLoanToValueRatio(e.target.value)}
                  placeholder="80"
                  disabled={disabled}
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="space-y-2">
              <Label htmlFor="interestRate" className="text-sm font-medium">Interest Rate</Label>
              <div className="relative">
                <Input
                  id="interestRate"
                  type="number"
                  step="0.01"
                  value={interestRate}
                  onChange={(e) => setInterestRate(e.target.value)}
                  placeholder="6.5"
                  disabled={disabled}
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="loanTermYears" className="text-sm font-medium">Loan Term</Label>
              <div className="relative">
                <Input
                  id="loanTermYears"
                  type="number"
                  value={loanTermYears}
                  onChange={(e) => setLoanTermYears(e.target.value)}
                  placeholder="30"
                  disabled={disabled}
                  className="pr-12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">yrs</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="capitalGrowth" className="text-sm font-medium flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                Growth
              </Label>
              <div className="relative">
                <Input
                  id="capitalGrowth"
                  type="number"
                  step="0.1"
                  value={capitalGrowth}
                  onChange={(e) => setCapitalGrowth(e.target.value)}
                  placeholder={localityGrowthEstimate ? localityGrowthEstimate.capitalGrowthPercent.toString() : "5"}
                  disabled={disabled}
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
              {isNewBuild && localityGrowthEstimate && !capitalGrowth && (
                <button 
                  type="button"
                  onClick={() => setCapitalGrowth(localityGrowthEstimate.capitalGrowthPercent.toString())}
                  className="text-xs text-primary hover:underline cursor-pointer"
                  disabled={disabled}
                >
                  Auto-fill {localityGrowthEstimate.capitalGrowthPercent}% ({localityGrowthEstimate.source})
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Loan Type</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={loanType === 'interest_only' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLoanType('interest_only')}
                disabled={disabled}
                className="flex-1"
              >
                Interest Only
              </Button>
              <Button
                type="button"
                variant={loanType === 'principal_interest' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLoanType('principal_interest')}
                disabled={disabled}
                className="flex-1"
              >
                Principal & Interest
              </Button>
            </div>
          </div>

          {loanAmount > 0 && (
            <div className="mt-4 p-4 bg-primary/5 rounded-lg border border-primary/20">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Est. Monthly {loanType === 'interest_only' ? 'Interest' : 'Repayment'}</span>
                <span className="text-xl font-bold text-primary">${monthlyInterest.toLocaleString()}/mo</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mortgage Repayment Calculator */}
      <Collapsible open={showMortgageCalculator} onOpenChange={setShowMortgageCalculator}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-between p-4 h-auto border-2 border-dashed border-brand-500/30 hover:border-brand-500/50 hover:bg-brand-500/5 rounded-lg"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-brand-500/10">
                <Banknote className="h-5 w-5 text-brand-600" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground">Mortgage Repayment Calculator</p>
                <p className="text-sm text-muted-foreground">
                  Calculate repayments, view amortisation schedule, and apply to cash flow
                </p>
              </div>
            </div>
            {showMortgageCalculator ? (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-4">
            <Separator />
            <MortgageRepaymentCalculator
              initialLoanAmount={loanAmount}
              initialInterestRate={parseFloat(interestRate) || 6.5}
              initialLoanTermYears={parseFloat(loanTermYears) || 30}
              initialLoanType={(loanType || 'principal_interest') as LoanType}
              initialInterestOnlyPeriodYears={parseFloat(propInterestOnlyPeriodYears || '0') || 0}
              initialRepaymentFrequency={(propRepaymentFrequency || 'monthly') as RepaymentFrequency}
              initialExtraRepayment={parseFloat(propExtraRepaymentPerMonth || '0') || 0}
              initialOffsetBalance={parseFloat(propOffsetBalance || '0') || 0}
              onApplyToOverrides={(values) => {
                if (values.loanAmount !== undefined && propSetLoanAmount) {
                  propSetLoanAmount(values.loanAmount.toString());
                }
                if (values.interestRate !== undefined) {
                  setInterestRate(values.interestRate.toString());
                }
                if (values.loanTermYears !== undefined) {
                  setLoanTermYears(values.loanTermYears.toString());
                }
                if (values.loanType !== undefined) {
                  setLoanType(values.loanType as 'interest_only' | 'principal_interest');
                }
                if (values.interestOnlyPeriodYears !== undefined && propSetInterestOnlyPeriodYears) {
                  propSetInterestOnlyPeriodYears(values.interestOnlyPeriodYears.toString());
                }
                if (values.repaymentFrequency !== undefined && propSetRepaymentFrequency) {
                  propSetRepaymentFrequency(values.repaymentFrequency);
                }
                if (values.extraRepaymentPerMonth !== undefined && propSetExtraRepaymentPerMonth) {
                  propSetExtraRepaymentPerMonth(values.extraRepaymentPerMonth.toString());
                }
                if (values.offsetBalance !== undefined && propSetOffsetBalance) {
                  propSetOffsetBalance(values.offsetBalance.toString());
                }
              }}
              onApplyLoanProjection={(projection) => {
                console.log('Loan projection applied:', projection);
              }}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Acquisition Costs Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              Acquisition Costs
            </h3>
            {isFirstHomeBuyer && (
              <Badge variant="secondary" className="bg-success/10 text-success">
                First Home Buyer
              </Badge>
            )}
          </div>

          <div className="space-y-4 mb-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="stampDuty" className="text-sm font-medium">Stamp Duty</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowStampDutyModal(true);
                  setManualStampDutyInput(stampDuty || '');
                }}
                disabled={disabled}
              >
                <Calculator className="h-4 w-4 mr-1" />
                Calculator
              </Button>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="stampDuty"
                type="text"
                inputMode="numeric"
                value={formatForDisplay(stampDuty)}
                onChange={handleCurrencyChange(setStampDuty)}
                placeholder="Use calculator or enter manually"
                disabled={disabled}
                className="pl-7"
              />
            </div>
            {isFirstHomeBuyer && (
              <p className="text-xs text-success">
                First Home Buyer concessions may apply based on state
              </p>
            )}
          </div>

          {/* Stamp Duty Calculator Modal - Using iframe for isolation */}
          <Dialog open={showStampDutyModal} onOpenChange={setShowStampDutyModal}>
            <DialogContent className="flex max-h-[calc(100dvh-4rem)] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-4rem)] sm:overflow-hidden sm:p-0">
              <DialogHeader className="shrink-0 border-b bg-background/95 px-6 pb-4 pt-6 pr-14">
                <DialogTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5 text-primary" />
                  Stamp Duty Calculator
                </DialogTitle>
                <DialogDescription>
                  Calculate stamp duty for {propertyAddress || 'your property'} ({detectedState})
                </DialogDescription>
              </DialogHeader>
              
              <div
                className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden overscroll-contain px-6 py-4 pb-10 [scrollbar-color:rgba(180,180,190,0.28)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/45 [&::-webkit-scrollbar-track]:bg-transparent"
                role="region"
                aria-label="Scrollable stamp duty calculator content"
                tabIndex={0}
              >
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <Home className="h-5 w-5 text-primary" />
                    <div>
                      <Label htmlFor="firstHomeBuyerCalcModal" className="text-sm font-semibold cursor-pointer">
                        First Home Buyer
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Enable for stamp duty concessions
                      </p>
                    </div>
                  </div>
                  <Switch
                    id="firstHomeBuyerCalcModal"
                    checked={isFirstHomeBuyer}
                    onCheckedChange={setIsFirstHomeBuyer}
                    disabled={disabled}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Building className="h-4 w-4 text-muted-foreground" />
                    Property Type
                  </Label>
                  <Select
                    value={stampDutyPropertyType}
                    onValueChange={(value) => setStampDutyPropertyType(value as StampDutyPropertyType)}
                    disabled={disabled}
                  >
                    <SelectTrigger className="w-full bg-background">
                      <SelectValue placeholder="Select property type" />
                    </SelectTrigger>
                    <SelectContent className="bg-background">
                      <SelectItem value="primary_residence">Primary Residence</SelectItem>
                      <SelectItem value="investment">Investment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    Are you purchasing
                  </Label>
                  <Select
                    value={stampDutyPurchaseType}
                    onValueChange={(value) => setStampDutyPurchaseType(value as StampDutyPurchaseType)}
                    disabled={disabled}
                  >
                    <SelectTrigger className="w-full bg-background">
                      <SelectValue placeholder="Select purchase type" />
                    </SelectTrigger>
                    <SelectContent className="bg-background">
                      <SelectItem value="established_home">An established home</SelectItem>
                      <SelectItem value="new_home">A new home</SelectItem>
                      <SelectItem value="vacant_land">Vacant Land</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    Property Value
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="text"
                      value={formatForDisplay(purchasePrice)}
                      disabled
                      className="pl-7 bg-muted/50"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Property value is pulled from the Purchase Price field
                  </p>
                </div>

                <Separator />

                {/* External Calculator Embed - Using iframe for complete isolation */}
                <div className="relative w-full min-h-0 overflow-visible rounded-lg border bg-white shadow-inner">
                  <iframe
                    ref={stampDutyIframeRef}
                    src={`/stamp-duty-embed.html?state=${detectedState}`}
                    className="block w-full min-h-[860px] border-0"
                    title="Stamp Duty Calculator"
                    sandbox="allow-scripts allow-same-origin allow-forms"
                  />
                </div>

                {/* Two-step stamp duty capture */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Stamp Duty Value:</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCaptureValue}
                      disabled={disabled || isCapturing}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      {isCapturing ? 'Capturing...' : 'Capture Calculated Value'}
                    </Button>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={formatForDisplay(manualStampDutyInput)}
                      onChange={(e) => handleManualStampDutyInputChange(e.target.value)}
                      placeholder="Value will appear here after capture"
                      className="pl-7"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Use the calculator above, then click "Capture Calculated Value". You can also manually adjust if needed.
                  </p>
                </div>

                {/* Show captured value and Use button */}
                {(capturedStampDuty || manualStampDutyInput) && parseFloat(capturedStampDuty || manualStampDutyInput) > 0 && (
                  <div className="flex items-center justify-between p-3 bg-success/10 rounded-lg border border-success/30">
                    <div className="flex items-center gap-3">
                      <Check className="h-5 w-5 text-success" />
                      <div>
                        <p className="text-sm font-semibold text-success">
                          Stamp Duty: ${formatNumberWithCommas(capturedStampDuty || manualStampDutyInput)}
                        </p>
                        <p className="text-xs text-success">
                          Ready to apply to your analysis
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={handleUseValue}
                      disabled={disabled}
                      className="bg-success hover:bg-success"
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Use Value
                    </Button>
                  </div>
                )}

                <p className="text-xs text-muted-foreground mt-2">
                  * Calculate stamp duty using the widget above, click "Capture Calculated Value" to extract it, then click "Use Value" to apply.
                </p>
              </div>
            </DialogContent>
          </Dialog>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="solicitorFees" className="text-sm font-medium">Solicitor / Conveyancing</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="solicitorFees"
                  type="text"
                  inputMode="numeric"
                  value={formatForDisplay(solicitorFees)}
                  onChange={handleCurrencyChange(setSolicitorFees)}
                  placeholder="1,500"
                  disabled={disabled}
                  className="pl-7"
                />
              </div>
            </div>
            {!isNewBuild && (
              <div className="space-y-2">
                <Label htmlFor="agentFee" className="text-sm font-medium">Agent Fee / Commission</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    id="agentFee"
                    type="text"
                    inputMode="numeric"
                    value={formatForDisplay(agentFee)}
                    onChange={handleCurrencyChange(setAgentFee)}
                    placeholder="15,000"
                    disabled={disabled}
                    className="pl-7"
                  />
                </div>
              </div>
            )}
          </div>

          {totalAcquisitionCosts > 0 && (
            <div className="mt-4 p-4 bg-muted/50 rounded-lg border">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Total Upfront Costs</span>
                <span className="text-xl font-bold">${totalAcquisitionCosts.toLocaleString()}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}