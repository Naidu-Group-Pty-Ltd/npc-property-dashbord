import { invokeSecureFunction } from '@/lib/secureInvoke';
import { INTAKE_SORT_FIELD } from '@/lib/airtableIntakeFields';

export interface PropertyListing {
  id: string;
  title: string;
  price: number | null;
  location: string;
  bedrooms: number | null;
  bathrooms: number | null;
  propertyType: string;
  listingDate: string;
  status: string;
  confidence: number | null;
  source: string;
  description: string;
  images: string[];
  agent: string;
  features: string[];
  // Enhanced fields for better data handling
  recordId?: string;
  url?: string;
  sourceHost?: string;
  hash?: string;
  messageId?: string;
  emailSubject?: string;
  from?: string;
  receivedAt?: Date | string;
  address?: string;
  suburb?: string;
  category?: string;
  beds?: number | null;
  baths?: number | null;
  carSpaces?: number | null;
  landSize?: string | number | null;
  lotNumber?: string;
  inspectionStart?: Date | string | null;
  inspectionEnd?: Date | string | null;
  inspectionNotes?: string;
  agencyName?: string;
  agentName?: string;
  agentPhone?: string;
  floorplans?: string[];
  summary?: string;
  keyEntities?: string;
  rawExtract?: string;
  createdTime?: Date | string;
  createdAt?: Date | string;
  webLinks?: string;
  state?: string;
  zipCode?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  // Enhanced analytics fields
  dataQuality?: number;
  isValidPrice?: boolean;
  isValidLocation?: boolean;
  completenessScore?: number;
  /** Raw Airtable fields exactly as returned by the proxy — used for table-specific extended views. */
  rawFields?: Record<string, any>;
}


export interface AirtableGetRecordsOptions {
  pageSize?: number;
  offset?: string;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  tableName?: string;
}

export interface AirtableTableInfo {
  id: string;
  name: string;
  primaryFieldId?: string;
}


export interface AirtableResponse {
  records: PropertyListing[];
  offset?: string;
  total: number;
}

class AirtableService {
  async getRecords(options: AirtableGetRecordsOptions = {}): Promise<AirtableResponse> {
    try {
      const { pageSize = 100, offset, sortField = INTAKE_SORT_FIELD, sortDirection = 'desc', tableName } = options;

      // Call the Supabase edge function instead of direct Airtable API
      const { data, error } = await invokeSecureFunction('airtable-proxy', {
        pageSize,
        offset,
        sortField,
        sortDirection,
        ...(tableName ? { tableName } : {}),
      });

      if (error) {
        console.error('Error calling airtable-proxy function:', error);
        throw new Error(`Failed to fetch Airtable records: ${error.message}`);
      }

      if (!data) {
        throw new Error('No data returned from airtable-proxy function');
      }

      if (data.error) {
        throw new Error(`Airtable API error: ${data.error}`);
      }

      // The airtable-proxy function already returns transformed data.
      // Attach the raw Airtable `fields` object as `rawFields` so UI can render table-specific
      // extended details (e.g. Property Intake Master rich fields).
      const records: PropertyListing[] = (data.records || []).map((r: any) => ({
        ...r,
        rawFields: r?.fields ?? undefined,
      }));
      return {
        records,
        offset: data.offset,
        total: data.total || 0,
      };

    } catch (error) {
      console.error('Failed to fetch Airtable records:', error);
      throw error;
    }
  }

  async listTables(): Promise<{ tables: AirtableTableInfo[]; defaultTableName: string | null }> {
    const { data, error } = await invokeSecureFunction('airtable-proxy', { op: 'list_tables' });
    if (error) throw new Error(`Failed to list Airtable tables: ${error.message}`);
    if (!data) throw new Error('No data returned from airtable-proxy list_tables');
    if (data.error) throw new Error(`Airtable API error: ${data.error}`);
    return {
      tables: (data.tables || []) as AirtableTableInfo[],
      defaultTableName: data.defaultTableName ?? null,
    };
  }


  async testConnection(): Promise<boolean> {
    try {
      const response = await this.getRecords({ pageSize: 1 });
      return response.records !== undefined;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }
}

export const airtableService = new AirtableService();
