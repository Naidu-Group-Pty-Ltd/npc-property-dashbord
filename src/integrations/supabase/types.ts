export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      abs_census_cache: {
        Row: {
          created_at: string
          data: Json
          data_quality: string
          dataset: string
          expires_at: string
          fetched_at: string
          id: string
          postcode: string
          state: string
        }
        Insert: {
          created_at?: string
          data: Json
          data_quality?: string
          dataset: string
          expires_at?: string
          fetched_at?: string
          id?: string
          postcode: string
          state: string
        }
        Update: {
          created_at?: string
          data?: Json
          data_quality?: string
          dataset?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          postcode?: string
          state?: string
        }
        Relationships: []
      }
      activity_logs: {
        Row: {
          action_type: Database["public"]["Enums"]["activity_action_type"]
          created_at: string
          entity_id: string | null
          entity_name: string | null
          entity_type: Database["public"]["Enums"]["activity_entity_type"]
          id: string
          ip_address: string | null
          metadata: Json | null
          user_agent: string | null
          user_id: string | null
          username: string | null
        }
        Insert: {
          action_type: Database["public"]["Enums"]["activity_action_type"]
          created_at?: string
          entity_id?: string | null
          entity_name?: string | null
          entity_type: Database["public"]["Enums"]["activity_entity_type"]
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          user_agent?: string | null
          user_id?: string | null
          username?: string | null
        }
        Update: {
          action_type?: Database["public"]["Enums"]["activity_action_type"]
          created_at?: string
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: Database["public"]["Enums"]["activity_entity_type"]
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          user_agent?: string | null
          user_id?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_agreements: {
        Row: {
          agreement_date: string
          buyer_address: string | null
          buyer_email: string | null
          buyer_names: string
          buyer_phone: string | null
          client_id: string
          created_at: string
          created_by: string | null
          deal_id: string | null
          docusign_envelope_id: string | null
          docusign_sent_at: string | null
          docusign_signed_at: string | null
          docusign_status: string | null
          docusign_voided_at: string | null
          gamma_document_id: string | null
          gamma_document_url: string | null
          id: string
          initial_commitment_fee: number | null
          notes: string | null
          pdf_storage_path: string | null
          secondary_buyer_email: string | null
          secondary_buyer_name: string | null
          sent_via: string | null
          signed_pdf_storage_path: string | null
          signing_layout: Json
          signing_prepared_at: string | null
          signing_recipients: Json
          status: string
          template_id: string | null
          updated_at: string
        }
        Insert: {
          agreement_date?: string
          buyer_address?: string | null
          buyer_email?: string | null
          buyer_names: string
          buyer_phone?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          docusign_envelope_id?: string | null
          docusign_sent_at?: string | null
          docusign_signed_at?: string | null
          docusign_status?: string | null
          docusign_voided_at?: string | null
          gamma_document_id?: string | null
          gamma_document_url?: string | null
          id?: string
          initial_commitment_fee?: number | null
          notes?: string | null
          pdf_storage_path?: string | null
          secondary_buyer_email?: string | null
          secondary_buyer_name?: string | null
          sent_via?: string | null
          signed_pdf_storage_path?: string | null
          signing_layout?: Json
          signing_prepared_at?: string | null
          signing_recipients?: Json
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          agreement_date?: string
          buyer_address?: string | null
          buyer_email?: string | null
          buyer_names?: string
          buyer_phone?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          docusign_envelope_id?: string | null
          docusign_sent_at?: string | null
          docusign_signed_at?: string | null
          docusign_status?: string | null
          docusign_voided_at?: string | null
          gamma_document_id?: string | null
          gamma_document_url?: string | null
          id?: string
          initial_commitment_fee?: number | null
          notes?: string | null
          pdf_storage_path?: string | null
          secondary_buyer_email?: string | null
          secondary_buyer_name?: string | null
          sent_via?: string | null
          signed_pdf_storage_path?: string | null
          signing_layout?: Json
          signing_prepared_at?: string | null
          signing_recipients?: Json
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_agreements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_agreements_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "client_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_agreements_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["client_deal_id"]
          },
          {
            foreignKeyName: "agency_agreements_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "gamma_agreement_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_action_log: {
        Row: {
          affected_client_id: string | null
          affected_record_id: string | null
          affected_table: string | null
          confidence_score: number | null
          conversation_id: string | null
          created_at: string
          execution_time_ms: number | null
          id: string
          is_rolled_back: boolean
          message_id: string | null
          plan_id: string | null
          rollback_data: Json | null
          rollback_sql: string | null
          rolled_back_at: string | null
          rolled_back_by: string | null
          status: string
          step_id: string | null
          tool_arguments: Json | null
          tool_name: string
          tool_result: Json | null
          user_id: string
        }
        Insert: {
          affected_client_id?: string | null
          affected_record_id?: string | null
          affected_table?: string | null
          confidence_score?: number | null
          conversation_id?: string | null
          created_at?: string
          execution_time_ms?: number | null
          id?: string
          is_rolled_back?: boolean
          message_id?: string | null
          plan_id?: string | null
          rollback_data?: Json | null
          rollback_sql?: string | null
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          status?: string
          step_id?: string | null
          tool_arguments?: Json | null
          tool_name: string
          tool_result?: Json | null
          user_id: string
        }
        Update: {
          affected_client_id?: string | null
          affected_record_id?: string | null
          affected_table?: string | null
          confidence_score?: number | null
          conversation_id?: string | null
          created_at?: string
          execution_time_ms?: number | null
          id?: string
          is_rolled_back?: boolean
          message_id?: string | null
          plan_id?: string | null
          rollback_data?: Json | null
          rollback_sql?: string | null
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          status?: string
          step_id?: string | null
          tool_arguments?: Json | null
          tool_name?: string
          tool_result?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_action_log_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_action_log_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "agent_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_action_log_rolled_back_by_fkey"
            columns: ["rolled_back_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_action_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_conversation_handoffs: {
        Row: {
          conversation_id: string
          created_at: string
          from_user_id: string
          handoff_type: string
          id: string
          message_id: string | null
          note: string | null
          to_user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          from_user_id: string
          handoff_type?: string
          id?: string
          message_id?: string | null
          note?: string | null
          to_user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          from_user_id?: string
          handoff_type?: string
          id?: string
          message_id?: string | null
          note?: string | null
          to_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversation_handoffs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversation_handoffs_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversation_handoffs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "agent_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversation_handoffs_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_conversation_shares: {
        Row: {
          conversation_id: string
          created_at: string
          handoff_note: string | null
          id: string
          is_active: boolean
          permission: string
          shared_by: string
          shared_with: string
          updated_at: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          handoff_note?: string | null
          id?: string
          is_active?: boolean
          permission?: string
          shared_by: string
          shared_with: string
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          handoff_note?: string | null
          id?: string
          is_active?: boolean
          permission?: string
          shared_by?: string
          shared_with?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversation_shares_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversation_shares_shared_by_fkey"
            columns: ["shared_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversation_shares_shared_with_fkey"
            columns: ["shared_with"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_eval_baselines: {
        Row: {
          created_at: string
          eval_count: number
          id: string
          name: string
          notes: string | null
          pass_count: number
          pass_rate: number
          promoted_by: string
          results: Json
        }
        Insert: {
          created_at?: string
          eval_count?: number
          id?: string
          name: string
          notes?: string | null
          pass_count?: number
          pass_rate?: number
          promoted_by: string
          results?: Json
        }
        Update: {
          created_at?: string
          eval_count?: number
          id?: string
          name?: string
          notes?: string | null
          pass_count?: number
          pass_rate?: number
          promoted_by?: string
          results?: Json
        }
        Relationships: []
      }
      agent_eval_runs: {
        Row: {
          created_at: string
          error: string | null
          eval_id: string
          grader_reasoning: string | null
          id: string
          latency_ms: number | null
          model: string | null
          passed: boolean | null
          response_text: string | null
          score: number | null
          tool_calls_used: string[]
          triggered_by: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          eval_id: string
          grader_reasoning?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          passed?: boolean | null
          response_text?: string | null
          score?: number | null
          tool_calls_used?: string[]
          triggered_by?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          eval_id?: string
          grader_reasoning?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          passed?: boolean | null
          response_text?: string | null
          score?: number | null
          tool_calls_used?: string[]
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_eval_runs_eval_id_fkey"
            columns: ["eval_id"]
            isOneToOne: false
            referencedRelation: "agent_evals"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_evals: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          expected_contains: string[]
          expected_not_contains: string[]
          expected_tools: string[]
          grader_prompt: string | null
          id: string
          is_enabled: boolean
          name: string
          prompt: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          expected_contains?: string[]
          expected_not_contains?: string[]
          expected_tools?: string[]
          grader_prompt?: string | null
          id?: string
          is_enabled?: boolean
          name: string
          prompt: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          expected_contains?: string[]
          expected_not_contains?: string[]
          expected_tools?: string[]
          grader_prompt?: string | null
          id?: string
          is_enabled?: boolean
          name?: string
          prompt?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      agent_file_uploads: {
        Row: {
          conversation_id: string | null
          created_at: string
          extracted_text: string | null
          file_category: string
          file_size: number
          filename: string
          id: string
          message_id: string | null
          metadata: Json | null
          mime_type: string
          storage_bucket: string
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          extracted_text?: string | null
          file_category?: string
          file_size?: number
          filename: string
          id?: string
          message_id?: string | null
          metadata?: Json | null
          mime_type: string
          storage_bucket?: string
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          extracted_text?: string | null
          file_category?: string
          file_size?: number
          filename?: string
          id?: string
          message_id?: string | null
          metadata?: Json | null
          mime_type?: string
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_file_uploads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_file_uploads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "agent_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_file_uploads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_insights_feed: {
        Row: {
          acted_on_at: string | null
          body_markdown: string | null
          created_at: string
          expires_at: string | null
          id: string
          is_dismissed: boolean
          is_read: boolean
          kind: string
          payload: Json
          related_conversation_id: string | null
          severity: string
          source: string
          summary: string | null
          title: string
          user_id: string
        }
        Insert: {
          acted_on_at?: string | null
          body_markdown?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_dismissed?: boolean
          is_read?: boolean
          kind?: string
          payload?: Json
          related_conversation_id?: string | null
          severity?: string
          source?: string
          summary?: string | null
          title: string
          user_id: string
        }
        Update: {
          acted_on_at?: string | null
          body_markdown?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_dismissed?: boolean
          is_read?: boolean
          kind?: string
          payload?: Json
          related_conversation_id?: string | null
          severity?: string
          source?: string
          summary?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_memory_feedback: {
        Row: {
          created_at: string
          id: string
          memory_id: string
          message_id: string | null
          rating: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          memory_id: string
          message_id?: string | null
          rating: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          memory_id?: string
          message_id?: string | null
          rating?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_memory_feedback_memory_id_fkey"
            columns: ["memory_id"]
            isOneToOne: false
            referencedRelation: "agent_semantic_memories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_memory_feedback_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "agent_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_messages: {
        Row: {
          confirmation_status: string | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          plan_id: string | null
          recalled_memory_ids: string[]
          requires_confirmation: boolean | null
          role: string
          sent_by: string | null
          step_id: string | null
          tool_calls: Json | null
          tool_results: Json | null
        }
        Insert: {
          confirmation_status?: string | null
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          plan_id?: string | null
          recalled_memory_ids?: string[]
          requires_confirmation?: boolean | null
          role: string
          sent_by?: string | null
          step_id?: string | null
          tool_calls?: Json | null
          tool_results?: Json | null
        }
        Update: {
          confirmation_status?: string | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          plan_id?: string | null
          recalled_memory_ids?: string[]
          requires_confirmation?: boolean | null
          role?: string
          sent_by?: string | null
          step_id?: string | null
          tool_calls?: Json | null
          tool_results?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_model_assignments: {
        Row: {
          agent_category: string
          agent_description: string | null
          agent_key: string
          agent_label: string
          created_at: string
          fallback_chain: Json
          id: string
          is_locked: boolean
          last_error: string | null
          last_used_at: string | null
          max_tokens: number | null
          model_id: string
          reasoning_effort: string | null
          route: string
          temperature: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          agent_category?: string
          agent_description?: string | null
          agent_key: string
          agent_label: string
          created_at?: string
          fallback_chain?: Json
          id?: string
          is_locked?: boolean
          last_error?: string | null
          last_used_at?: string | null
          max_tokens?: number | null
          model_id: string
          reasoning_effort?: string | null
          route?: string
          temperature?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          agent_category?: string
          agent_description?: string | null
          agent_key?: string
          agent_label?: string
          created_at?: string
          fallback_chain?: Json
          id?: string
          is_locked?: boolean
          last_error?: string | null
          last_used_at?: string | null
          max_tokens?: number | null
          model_id?: string
          reasoning_effort?: string | null
          route?: string
          temperature?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      agent_plan_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          plan_id: string
          started_at: string
          status: string
          steps_executed: number
          steps_failed: number
          triggered_by: string
          user_id: string
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          plan_id: string
          started_at?: string
          status?: string
          steps_executed?: number
          steps_failed?: number
          triggered_by?: string
          user_id: string
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          plan_id?: string
          started_at?: string
          status?: string
          steps_executed?: number
          steps_failed?: number
          triggered_by?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_plan_runs_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "agent_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_plan_steps: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          error: string | null
          expected_output: string | null
          id: string
          plan_id: string
          result: Json | null
          seq: number
          started_at: string | null
          status: string
          title: string
          tool_calls: Json
          tool_hint: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          error?: string | null
          expected_output?: string | null
          id?: string
          plan_id: string
          result?: Json | null
          seq: number
          started_at?: string | null
          status?: string
          title: string
          tool_calls?: Json
          tool_hint?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          error?: string | null
          expected_output?: string | null
          id?: string
          plan_id?: string
          result?: Json | null
          seq?: number
          started_at?: string | null
          status?: string
          title?: string
          tool_calls?: Json
          tool_hint?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_plan_steps_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "agent_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_plans: {
        Row: {
          auto_execute: boolean
          completed_at: string | null
          completed_steps: number
          context: Json
          created_at: string
          goal: string
          id: string
          is_template: boolean
          last_run_at: string | null
          next_run_at: string | null
          planner_model: string | null
          requires_approval: boolean
          schedule_cron: string | null
          skill_slug: string | null
          status: string
          title: string
          total_steps: number
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_execute?: boolean
          completed_at?: string | null
          completed_steps?: number
          context?: Json
          created_at?: string
          goal: string
          id?: string
          is_template?: boolean
          last_run_at?: string | null
          next_run_at?: string | null
          planner_model?: string | null
          requires_approval?: boolean
          schedule_cron?: string | null
          skill_slug?: string | null
          status?: string
          title: string
          total_steps?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_execute?: boolean
          completed_at?: string | null
          completed_steps?: number
          context?: Json
          created_at?: string
          goal?: string
          id?: string
          is_template?: boolean
          last_run_at?: string | null
          next_run_at?: string | null
          planner_model?: string | null
          requires_approval?: boolean
          schedule_cron?: string | null
          skill_slug?: string | null
          status?: string
          title?: string
          total_steps?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_playbooks: {
        Row: {
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_public: boolean | null
          last_run_at: string | null
          name: string
          run_count: number | null
          steps: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_public?: boolean | null
          last_run_at?: string | null
          name: string
          run_count?: number | null
          steps?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_public?: boolean | null
          last_run_at?: string | null
          name?: string
          run_count?: number | null
          steps?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_playbooks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_scheduled_tasks: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_enabled: boolean | null
          last_run_at: string | null
          last_run_result: Json | null
          last_run_status: string | null
          name: string
          next_run_at: string | null
          playbook_id: string | null
          run_count: number | null
          schedule_cron: string
          schedule_description: string | null
          task_type: string
          tool_arguments: Json | null
          tool_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean | null
          last_run_at?: string | null
          last_run_result?: Json | null
          last_run_status?: string | null
          name: string
          next_run_at?: string | null
          playbook_id?: string | null
          run_count?: number | null
          schedule_cron: string
          schedule_description?: string | null
          task_type?: string
          tool_arguments?: Json | null
          tool_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean | null
          last_run_at?: string | null
          last_run_result?: Json | null
          last_run_status?: string | null
          name?: string
          next_run_at?: string | null
          playbook_id?: string | null
          run_count?: number | null
          schedule_cron?: string
          schedule_description?: string | null
          task_type?: string
          tool_arguments?: Json | null
          tool_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_scheduled_tasks_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "agent_playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_scheduled_tasks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_semantic_memories: {
        Row: {
          content: string
          content_hash: string
          conversation_id: string | null
          created_at: string
          embedding: string
          feedback_score: number
          id: string
          importance: number
          kind: string
          last_used_at: string | null
          source_message_id: string | null
          tags: string[]
          updated_at: string
          use_count: number
          user_id: string
        }
        Insert: {
          content: string
          content_hash: string
          conversation_id?: string | null
          created_at?: string
          embedding: string
          feedback_score?: number
          id?: string
          importance?: number
          kind?: string
          last_used_at?: string | null
          source_message_id?: string | null
          tags?: string[]
          updated_at?: string
          use_count?: number
          user_id: string
        }
        Update: {
          content?: string
          content_hash?: string
          conversation_id?: string | null
          created_at?: string
          embedding?: string
          feedback_score?: number
          id?: string
          importance?: number
          kind?: string
          last_used_at?: string | null
          source_message_id?: string | null
          tags?: string[]
          updated_at?: string
          use_count?: number
          user_id?: string
        }
        Relationships: []
      }
      agent_skill_installs: {
        Row: {
          id: string
          installed_at: string
          overrides: Json
          skill_id: string
          skill_snapshot: Json
          uninstalled_at: string | null
          user_id: string
        }
        Insert: {
          id?: string
          installed_at?: string
          overrides?: Json
          skill_id: string
          skill_snapshot?: Json
          uninstalled_at?: string | null
          user_id: string
        }
        Update: {
          id?: string
          installed_at?: string
          overrides?: Json
          skill_id?: string
          skill_snapshot?: Json
          uninstalled_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      agent_skills: {
        Row: {
          allowed_tools: string[]
          avg_success_rate: number | null
          created_at: string
          default_model: string | null
          description: string | null
          icon: string | null
          id: string
          install_count: number
          is_enabled: boolean
          is_public: boolean
          last_run_at: string | null
          name: string
          run_count: number
          slug: string
          system_prompt: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          allowed_tools?: string[]
          avg_success_rate?: number | null
          created_at?: string
          default_model?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          install_count?: number
          is_enabled?: boolean
          is_public?: boolean
          last_run_at?: string | null
          name: string
          run_count?: number
          slug: string
          system_prompt: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          allowed_tools?: string[]
          avg_success_rate?: number | null
          created_at?: string
          default_model?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          install_count?: number
          is_enabled?: boolean
          is_public?: boolean
          last_run_at?: string | null
          name?: string
          run_count?: number
          slug?: string
          system_prompt?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      agent_user_preferences: {
        Row: {
          created_at: string
          id: string
          preference_key: string
          preference_value: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          preference_key: string
          preference_value?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          preference_key?: string
          preference_value?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_user_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_coach_insights: {
        Row: {
          action_label: string | null
          action_path: string | null
          body: string | null
          category: string | null
          dismissed_at: string | null
          finance_user_id: string
          generated_at: string
          id: string
          model: string | null
          title: string
        }
        Insert: {
          action_label?: string | null
          action_path?: string | null
          body?: string | null
          category?: string | null
          dismissed_at?: string | null
          finance_user_id: string
          generated_at?: string
          id?: string
          model?: string | null
          title: string
        }
        Update: {
          action_label?: string | null
          action_path?: string | null
          body?: string | null
          category?: string | null
          dismissed_at?: string | null
          finance_user_id?: string
          generated_at?: string
          id?: string
          model?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_coach_insights_finance_user_id_fkey"
            columns: ["finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_doc_classifications: {
        Row: {
          classified_type: string | null
          confidence: number | null
          document_id: string | null
          document_instance_id: string | null
          extracted_fields: Json | null
          generated_at: string
          id: string
          is_expired: boolean | null
          model: string | null
          period_label: string | null
          purchase_file_id: string | null
          suggested_label: string | null
        }
        Insert: {
          classified_type?: string | null
          confidence?: number | null
          document_id?: string | null
          document_instance_id?: string | null
          extracted_fields?: Json | null
          generated_at?: string
          id?: string
          is_expired?: boolean | null
          model?: string | null
          period_label?: string | null
          purchase_file_id?: string | null
          suggested_label?: string | null
        }
        Update: {
          classified_type?: string | null
          confidence?: number | null
          document_id?: string | null
          document_instance_id?: string | null
          extracted_fields?: Json | null
          generated_at?: string
          id?: string
          is_expired?: boolean | null
          model?: string | null
          period_label?: string | null
          purchase_file_id?: string | null
          suggested_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_doc_classifications_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_doc_classifications_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      ai_lender_recommendations: {
        Row: {
          generated_at: string
          id: string
          model: string | null
          purchase_file_id: string
          rationale: string | null
          recommendations: Json
        }
        Insert: {
          generated_at?: string
          id?: string
          model?: string | null
          purchase_file_id: string
          rationale?: string | null
          recommendations?: Json
        }
        Update: {
          generated_at?: string
          id?: string
          model?: string | null
          purchase_file_id?: string
          rationale?: string | null
          recommendations?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_lender_recommendations_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_lender_recommendations_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      ai_loan_app_prefills: {
        Row: {
          extracted: Json
          generated_at: string
          generated_by: string | null
          id: string
          model: string | null
          purchase_file_id: string
          source_doc_ids: string[] | null
        }
        Insert: {
          extracted?: Json
          generated_at?: string
          generated_by?: string | null
          id?: string
          model?: string | null
          purchase_file_id: string
          source_doc_ids?: string[] | null
        }
        Update: {
          extracted?: Json
          generated_at?: string
          generated_by?: string | null
          id?: string
          model?: string | null
          purchase_file_id?: string
          source_doc_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_loan_app_prefills_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_loan_app_prefills_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      ai_pf_summaries: {
        Row: {
          generated_at: string
          generated_by: string | null
          model: string | null
          purchase_file_id: string
          summary: Json
        }
        Insert: {
          generated_at?: string
          generated_by?: string | null
          model?: string | null
          purchase_file_id: string
          summary?: Json
        }
        Update: {
          generated_at?: string
          generated_by?: string | null
          model?: string | null
          purchase_file_id?: string
          summary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_pf_summaries_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: true
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_pf_summaries_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: true
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      ai_risk_alerts: {
        Row: {
          alert_type: string
          details: Json | null
          finance_user_id: string | null
          generated_at: string
          id: string
          model: string | null
          purchase_file_id: string | null
          resolved_at: string | null
          severity: string
          status: string
          summary: string | null
          title: string
        }
        Insert: {
          alert_type: string
          details?: Json | null
          finance_user_id?: string | null
          generated_at?: string
          id?: string
          model?: string | null
          purchase_file_id?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          summary?: string | null
          title: string
        }
        Update: {
          alert_type?: string
          details?: Json | null
          finance_user_id?: string | null
          generated_at?: string
          id?: string
          model?: string | null
          purchase_file_id?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          summary?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_risk_alerts_finance_user_id_fkey"
            columns: ["finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_risk_alerts_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_risk_alerts_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      ai_voice_memos: {
        Row: {
          client_id: string | null
          created_at: string
          duration_seconds: number | null
          finance_user_id: string
          id: string
          model: string | null
          purchase_file_id: string | null
          saved_as_note: boolean | null
          summary: string | null
          transcript: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          finance_user_id: string
          id?: string
          model?: string | null
          purchase_file_id?: string | null
          saved_as_note?: boolean | null
          summary?: string | null
          transcript?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          finance_user_id?: string
          id?: string
          model?: string | null
          purchase_file_id?: string | null
          saved_as_note?: boolean | null
          summary?: string | null
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_voice_memos_finance_user_id_fkey"
            columns: ["finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_voice_memos_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_voice_memos_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      api_health_log: {
        Row: {
          created_at: string
          data_quality: string | null
          endpoint: string | null
          error_message: string | null
          id: string
          response_time_ms: number | null
          service_name: string
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          data_quality?: string | null
          endpoint?: string | null
          error_message?: string | null
          id?: string
          response_time_ms?: number | null
          service_name: string
          status: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          data_quality?: string | null
          endpoint?: string | null
          error_message?: string | null
          id?: string
          response_time_ms?: number | null
          service_name?: string
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      api_usage_log: {
        Row: {
          completion_tokens: number | null
          cost_estimate_usd: number | null
          created_at: string
          endpoint: string | null
          id: string
          metadata: Json | null
          model_used: string | null
          prompt_tokens: number | null
          request_count: number
          response_time_ms: number | null
          service_name: string
          status: string
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          completion_tokens?: number | null
          cost_estimate_usd?: number | null
          created_at?: string
          endpoint?: string | null
          id?: string
          metadata?: Json | null
          model_used?: string | null
          prompt_tokens?: number | null
          request_count?: number
          response_time_ms?: number | null
          service_name: string
          status?: string
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          completion_tokens?: number | null
          cost_estimate_usd?: number | null
          created_at?: string
          endpoint?: string | null
          id?: string
          metadata?: Json | null
          model_used?: string | null
          prompt_tokens?: number | null
          request_count?: number
          response_time_ms?: number | null
          service_name?: string
          status?: string
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      appointment_secondary_recipients: {
        Row: {
          appointment_end: string | null
          appointment_ghl_id: string
          appointment_notes: string | null
          appointment_start: string | null
          appointment_title: string | null
          appointment_type: string | null
          calendar_name: string | null
          contact_email: string
          contact_name: string
          created_at: string
          finance_contact_id: string
          id: string
          notification_error: string | null
          notification_sent: boolean
          notification_sent_at: string | null
          updated_at: string
        }
        Insert: {
          appointment_end?: string | null
          appointment_ghl_id: string
          appointment_notes?: string | null
          appointment_start?: string | null
          appointment_title?: string | null
          appointment_type?: string | null
          calendar_name?: string | null
          contact_email: string
          contact_name: string
          created_at?: string
          finance_contact_id: string
          id?: string
          notification_error?: string | null
          notification_sent?: boolean
          notification_sent_at?: string | null
          updated_at?: string
        }
        Update: {
          appointment_end?: string | null
          appointment_ghl_id?: string
          appointment_notes?: string | null
          appointment_start?: string | null
          appointment_title?: string | null
          appointment_type?: string | null
          calendar_name?: string | null
          contact_email?: string
          contact_name?: string
          created_at?: string
          finance_contact_id?: string
          id?: string
          notification_error?: string | null
          notification_sent?: boolean
          notification_sent_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      auth_rate_limits: {
        Row: {
          bucket_key: string
          count: number
          updated_at: string
          window_start: string
        }
        Insert: {
          bucket_key: string
          count?: number
          updated_at?: string
          window_start?: string
        }
        Update: {
          bucket_key?: string
          count?: number
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      auto_report_generation_log: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          listing_address: string
          listing_id: string
          report_id: string | null
          status: string
          switch_id: string | null
          switch_name: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          listing_address: string
          listing_id: string
          report_id?: string | null
          status?: string
          switch_id?: string | null
          switch_name?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          listing_address?: string
          listing_id?: string
          report_id?: string | null
          status?: string
          switch_id?: string | null
          switch_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auto_report_generation_log_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "investment_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_report_generation_log_switch_id_fkey"
            columns: ["switch_id"]
            isOneToOne: false
            referencedRelation: "auto_report_switches"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_report_master_settings: {
        Row: {
          id: string
          is_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          is_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          is_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auto_report_master_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_report_processed_listings: {
        Row: {
          id: string
          listing_address: string | null
          listing_id: string
          processed_at: string
          report_id: string | null
          skip_reason: string | null
          skipped: boolean
          switch_id: string | null
        }
        Insert: {
          id?: string
          listing_address?: string | null
          listing_id: string
          processed_at?: string
          report_id?: string | null
          skip_reason?: string | null
          skipped?: boolean
          switch_id?: string | null
        }
        Update: {
          id?: string
          listing_address?: string | null
          listing_id?: string
          processed_at?: string
          report_id?: string | null
          skip_reason?: string | null
          skipped?: boolean
          switch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auto_report_processed_listings_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "investment_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_report_processed_listings_switch_id_fkey"
            columns: ["switch_id"]
            isOneToOne: false
            referencedRelation: "auto_report_switches"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_report_switches: {
        Row: {
          created_at: string
          created_by: string | null
          criteria: Json
          description: string | null
          id: string
          is_enabled: boolean
          name: string
          priority: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          criteria?: Json
          description?: string | null
          id?: string
          is_enabled?: boolean
          name: string
          priority?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          criteria?: Json
          description?: string | null
          id?: string
          is_enabled?: boolean
          name?: string
          priority?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_report_switches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_lending_rates_cache: {
        Row: {
          created_at: string
          expires_at: string
          fetched_at: string
          lender_id: string
          lender_name: string
          rates: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          fetched_at?: string
          lender_id: string
          lender_name: string
          rates?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          fetched_at?: string
          lender_id?: string
          lender_name?: string
          rates?: Json
          updated_at?: string
        }
        Relationships: []
      }
      bc_scenarios: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          is_base: boolean
          name: string
          payload: Json
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_base?: boolean
          name: string
          payload?: Json
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_base?: boolean
          name?: string
          payload?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bc_scenarios_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bc_scenarios_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      blacklisted_numbers: {
        Row: {
          announce_message: string | null
          category: string
          created_at: string
          created_by: string | null
          created_by_username: string | null
          hit_count: number
          id: string
          is_active: boolean
          kill_mode: string
          last_hit_at: string | null
          normalized_number: string
          notes: string | null
          phone_number: string
          updated_at: string
        }
        Insert: {
          announce_message?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          created_by_username?: string | null
          hit_count?: number
          id?: string
          is_active?: boolean
          kill_mode?: string
          last_hit_at?: string | null
          normalized_number: string
          notes?: string | null
          phone_number: string
          updated_at?: string
        }
        Update: {
          announce_message?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          created_by_username?: string | null
          hit_count?: number
          id?: string
          is_active?: boolean
          kill_mode?: string
          last_hit_at?: string | null
          normalized_number?: string
          notes?: string | null
          phone_number?: string
          updated_at?: string
        }
        Relationships: []
      }
      borrowing_capacity_assessments: {
        Row: {
          assessment_rate: number | null
          assumptions: Json | null
          borrowing_capacity: number
          buffer_rate: number | null
          calculated_by: string | null
          client_id: string
          created_at: string
          deposit_amount: number | null
          dti_ratio: number | null
          existing_commitments_monthly: number
          expense_breakdown: Json | null
          expense_method: string | null
          gross_annual_income: number
          id: string
          income_breakdown: Json | null
          interest_rate_used: number | null
          liability_breakdown: Json | null
          living_expenses_monthly: number
          lmi_amount: number | null
          lmi_lvr_trigger: number | null
          lmi_mode: string | null
          loan_term_years: number | null
          monthly_surplus: number
          net_purchase_capacity: number | null
          property_value_estimate: number | null
          proposed_loan_amount: number | null
          proposed_lvr: number | null
          recommendations: Json | null
          serviceability_band: string
          shaded_annual_income: number
          stress_tested_capacity: number | null
          updated_at: string
          warnings: string[] | null
        }
        Insert: {
          assessment_rate?: number | null
          assumptions?: Json | null
          borrowing_capacity?: number
          buffer_rate?: number | null
          calculated_by?: string | null
          client_id: string
          created_at?: string
          deposit_amount?: number | null
          dti_ratio?: number | null
          existing_commitments_monthly?: number
          expense_breakdown?: Json | null
          expense_method?: string | null
          gross_annual_income?: number
          id?: string
          income_breakdown?: Json | null
          interest_rate_used?: number | null
          liability_breakdown?: Json | null
          living_expenses_monthly?: number
          lmi_amount?: number | null
          lmi_lvr_trigger?: number | null
          lmi_mode?: string | null
          loan_term_years?: number | null
          monthly_surplus?: number
          net_purchase_capacity?: number | null
          property_value_estimate?: number | null
          proposed_loan_amount?: number | null
          proposed_lvr?: number | null
          recommendations?: Json | null
          serviceability_band?: string
          shaded_annual_income?: number
          stress_tested_capacity?: number | null
          updated_at?: string
          warnings?: string[] | null
        }
        Update: {
          assessment_rate?: number | null
          assumptions?: Json | null
          borrowing_capacity?: number
          buffer_rate?: number | null
          calculated_by?: string | null
          client_id?: string
          created_at?: string
          deposit_amount?: number | null
          dti_ratio?: number | null
          existing_commitments_monthly?: number
          expense_breakdown?: Json | null
          expense_method?: string | null
          gross_annual_income?: number
          id?: string
          income_breakdown?: Json | null
          interest_rate_used?: number | null
          liability_breakdown?: Json | null
          living_expenses_monthly?: number
          lmi_amount?: number | null
          lmi_lvr_trigger?: number | null
          lmi_mode?: string | null
          loan_term_years?: number | null
          monthly_surplus?: number
          net_purchase_capacity?: number | null
          property_value_estimate?: number | null
          proposed_loan_amount?: number | null
          proposed_lvr?: number | null
          recommendations?: Json | null
          serviceability_band?: string
          shaded_annual_income?: number
          stress_tested_capacity?: number | null
          updated_at?: string
          warnings?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "borrowing_capacity_assessments_calculated_by_fkey"
            columns: ["calculated_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "borrowing_capacity_assessments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_kits: {
        Row: {
          created_at: string
          created_by: string | null
          default_disclaimer: string | null
          default_footer: string | null
          description: string | null
          font_pairing: Json
          id: string
          is_default: boolean
          logo_mark_url: string | null
          logo_primary_url: string | null
          logo_secondary_url: string | null
          name: string
          palette: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_disclaimer?: string | null
          default_footer?: string | null
          description?: string | null
          font_pairing?: Json
          id?: string
          is_default?: boolean
          logo_mark_url?: string | null
          logo_primary_url?: string | null
          logo_secondary_url?: string | null
          name: string
          palette?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_disclaimer?: string | null
          default_footer?: string | null
          description?: string | null
          font_pairing?: Json
          id?: string
          is_default?: boolean
          logo_mark_url?: string | null
          logo_primary_url?: string | null
          logo_secondary_url?: string | null
          name?: string
          palette?: Json
          updated_at?: string
        }
        Relationships: []
      }
      build_progress_payments: {
        Row: {
          amount: number | null
          builder_invoice_date: string | null
          builder_invoice_received: boolean | null
          commission_amount: number | null
          commission_received: boolean | null
          commission_received_date: string | null
          created_at: string
          deal_id: string
          display_order: number
          funds_released: boolean | null
          funds_released_date: string | null
          id: string
          is_commission_trigger: boolean | null
          notes: string | null
          paid_to_builder: boolean | null
          paid_to_builder_date: string | null
          percentage: number
          stage_name: string
          stage_number: number
          submitted_to_lender: boolean | null
          submitted_to_lender_date: string | null
          updated_at: string
        }
        Insert: {
          amount?: number | null
          builder_invoice_date?: string | null
          builder_invoice_received?: boolean | null
          commission_amount?: number | null
          commission_received?: boolean | null
          commission_received_date?: string | null
          created_at?: string
          deal_id: string
          display_order?: number
          funds_released?: boolean | null
          funds_released_date?: string | null
          id?: string
          is_commission_trigger?: boolean | null
          notes?: string | null
          paid_to_builder?: boolean | null
          paid_to_builder_date?: string | null
          percentage?: number
          stage_name: string
          stage_number: number
          submitted_to_lender?: boolean | null
          submitted_to_lender_date?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number | null
          builder_invoice_date?: string | null
          builder_invoice_received?: boolean | null
          commission_amount?: number | null
          commission_received?: boolean | null
          commission_received_date?: string | null
          created_at?: string
          deal_id?: string
          display_order?: number
          funds_released?: boolean | null
          funds_released_date?: string | null
          id?: string
          is_commission_trigger?: boolean | null
          notes?: string | null
          paid_to_builder?: boolean | null
          paid_to_builder_date?: string | null
          percentage?: number
          stage_name?: string
          stage_number?: number
          submitted_to_lender?: boolean | null
          submitted_to_lender_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "build_progress_payments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "client_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "build_progress_payments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["client_deal_id"]
          },
        ]
      }
      builder_invoices: {
        Row: {
          build_payment_id: string | null
          build_stage: string | null
          client_name: string | null
          commission_amount: number | null
          commission_received: boolean | null
          created_at: string
          deal_id: string
          funds_released: boolean | null
          funds_released_date: string | null
          id: string
          invoice_amount: number | null
          invoice_date: string | null
          notes: string | null
          paid_to_builder: boolean | null
          paid_to_builder_date: string | null
          submitted_date: string | null
          submitted_to_lender: boolean | null
        }
        Insert: {
          build_payment_id?: string | null
          build_stage?: string | null
          client_name?: string | null
          commission_amount?: number | null
          commission_received?: boolean | null
          created_at?: string
          deal_id: string
          funds_released?: boolean | null
          funds_released_date?: string | null
          id?: string
          invoice_amount?: number | null
          invoice_date?: string | null
          notes?: string | null
          paid_to_builder?: boolean | null
          paid_to_builder_date?: string | null
          submitted_date?: string | null
          submitted_to_lender?: boolean | null
        }
        Update: {
          build_payment_id?: string | null
          build_stage?: string | null
          client_name?: string | null
          commission_amount?: number | null
          commission_received?: boolean | null
          created_at?: string
          deal_id?: string
          funds_released?: boolean | null
          funds_released_date?: string | null
          id?: string
          invoice_amount?: number | null
          invoice_date?: string | null
          notes?: string | null
          paid_to_builder?: boolean | null
          paid_to_builder_date?: string | null
          submitted_date?: string | null
          submitted_to_lender?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_invoices_build_payment_id_fkey"
            columns: ["build_payment_id"]
            isOneToOne: false
            referencedRelation: "build_progress_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "client_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["client_deal_id"]
          },
        ]
      }
      bulk_generation_items: {
        Row: {
          attempts: number
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          heartbeat_at: string | null
          id: string
          job_id: string
          last_error_at: string | null
          max_attempts: number
          processing_time_seconds: number | null
          property_address: string
          property_listing_id: string
          report_id: string | null
          started_at: string | null
          status: string
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          heartbeat_at?: string | null
          id?: string
          job_id: string
          last_error_at?: string | null
          max_attempts?: number
          processing_time_seconds?: number | null
          property_address: string
          property_listing_id: string
          report_id?: string | null
          started_at?: string | null
          status?: string
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          heartbeat_at?: string | null
          id?: string
          job_id?: string
          last_error_at?: string | null
          max_attempts?: number
          processing_time_seconds?: number | null
          property_address?: string
          property_listing_id?: string
          report_id?: string | null
          started_at?: string | null
          status?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bulk_generation_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "bulk_generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_generation_items_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "investment_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_generation_jobs: {
        Row: {
          completed_at: string | null
          completed_reports: number
          created_at: string
          created_by: string
          error_message: string | null
          failed_reports: number
          id: string
          property_addresses: string[]
          property_ids: string[]
          started_at: string | null
          status: string
          total_reports: number
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_reports?: number
          created_at?: string
          created_by: string
          error_message?: string | null
          failed_reports?: number
          id?: string
          property_addresses: string[]
          property_ids: string[]
          started_at?: string | null
          status?: string
          total_reports: number
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_reports?: number
          created_at?: string
          created_by?: string
          error_message?: string | null
          failed_reports?: number
          id?: string
          property_addresses?: string[]
          property_ids?: string[]
          started_at?: string | null
          status?: string
          total_reports?: number
          updated_at?: string
        }
        Relationships: []
      }
      call_alert_history: {
        Row: {
          call_id: string | null
          id: string
          is_positive: boolean
          is_read: boolean
          message: string
          rule_id: string | null
          rule_name: string
          triggered_at: string
        }
        Insert: {
          call_id?: string | null
          id?: string
          is_positive?: boolean
          is_read?: boolean
          message: string
          rule_id?: string | null
          rule_name: string
          triggered_at?: string
        }
        Update: {
          call_id?: string | null
          id?: string
          is_positive?: boolean
          is_read?: boolean
          message?: string
          rule_id?: string | null
          rule_name?: string
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_alert_history_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "vapi_call_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_alert_history_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "call_alert_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      call_alert_rules: {
        Row: {
          condition_operator: string
          condition_type: string
          condition_value: string
          created_at: string
          id: string
          is_enabled: boolean
          is_positive: boolean
          name: string
          notification_type: string
          updated_at: string
        }
        Insert: {
          condition_operator: string
          condition_type: string
          condition_value: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          is_positive?: boolean
          name: string
          notification_type?: string
          updated_at?: string
        }
        Update: {
          condition_operator?: string
          condition_type?: string
          condition_value?: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          is_positive?: boolean
          name?: string
          notification_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      call_tags: {
        Row: {
          color: string
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      cash_flow_analyses: {
        Row: {
          analysis_data: Json
          comparison_report_ids: string[]
          created_at: string
          created_by: string | null
          id: string
          investor_profile: string | null
          primary_report_id: string
          updated_at: string
        }
        Insert: {
          analysis_data: Json
          comparison_report_ids?: string[]
          created_at?: string
          created_by?: string | null
          id?: string
          investor_profile?: string | null
          primary_report_id: string
          updated_at?: string
        }
        Update: {
          analysis_data?: Json
          comparison_report_ids?: string[]
          created_at?: string
          created_by?: string | null
          id?: string
          investor_profile?: string | null
          primary_report_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_flow_analyses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_flow_analyses_primary_report_id_fkey"
            columns: ["primary_report_id"]
            isOneToOne: false
            referencedRelation: "investment_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_analysis: {
        Row: {
          analysis_text: string
          chart_id: string
          confidence_score: number | null
          created_at: string
          id: string
          model_used: string | null
          updated_at: string
        }
        Insert: {
          analysis_text: string
          chart_id: string
          confidence_score?: number | null
          created_at?: string
          id?: string
          model_used?: string | null
          updated_at?: string
        }
        Update: {
          analysis_text?: string
          chart_id?: string
          confidence_score?: number | null
          created_at?: string
          id?: string
          model_used?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chart_analysis_chart_id_fkey"
            columns: ["chart_id"]
            isOneToOne: false
            referencedRelation: "charts"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_configurations: {
        Row: {
          chart_type: string
          created_at: string
          default_styling: Json | null
          id: string
          quickchart_config: Json
          template_name: string
          updated_at: string
        }
        Insert: {
          chart_type: string
          created_at?: string
          default_styling?: Json | null
          id?: string
          quickchart_config: Json
          template_name: string
          updated_at?: string
        }
        Update: {
          chart_type?: string
          created_at?: string
          default_styling?: Json | null
          id?: string
          quickchart_config?: Json
          template_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      charts: {
        Row: {
          analysis_text: string | null
          chart_config: Json | null
          chart_key: string | null
          chart_type: string
          created_at: string
          dataset: Json | null
          generated_at: string | null
          id: string
          image_data: string
          report_date: string | null
          report_id: string
          sort_order: number | null
          summary_text: string | null
          title: string
          updated_at: string
        }
        Insert: {
          analysis_text?: string | null
          chart_config?: Json | null
          chart_key?: string | null
          chart_type: string
          created_at?: string
          dataset?: Json | null
          generated_at?: string | null
          id?: string
          image_data: string
          report_date?: string | null
          report_id: string
          sort_order?: number | null
          summary_text?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          analysis_text?: string | null
          chart_config?: Json | null
          chart_key?: string | null
          chart_type?: string
          created_at?: string
          dataset?: Json | null
          generated_at?: string | null
          id?: string
          image_data?: string
          report_date?: string | null
          report_id?: string
          sort_order?: number | null
          summary_text?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "charts_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "generated_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_instance_items: {
        Row: {
          checked_at: string | null
          checked_by: string | null
          created_at: string
          display_order: number
          id: string
          instance_id: string
          is_checked: boolean | null
          label: string
          section_icon: string | null
          section_order: number
          section_title: string
        }
        Insert: {
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          display_order?: number
          id?: string
          instance_id: string
          is_checked?: boolean | null
          label: string
          section_icon?: string | null
          section_order?: number
          section_title: string
        }
        Update: {
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          display_order?: number
          id?: string
          instance_id?: string
          is_checked?: boolean | null
          label?: string
          section_icon?: string | null
          section_order?: number
          section_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_instance_items_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "checklist_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_instances: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          generated_by: string | null
          icon: string | null
          id: string
          name: string
          progress_percent: number | null
          recurrence_key: string | null
          status: string
          template_id: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          generated_by?: string | null
          icon?: string | null
          id?: string
          name: string
          progress_percent?: number | null
          recurrence_key?: string | null
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          generated_by?: string | null
          icon?: string | null
          id?: string
          name?: string
          progress_percent?: number | null
          recurrence_key?: string | null
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_instances_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_template_items: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_pre_checked: boolean | null
          label: string
          section_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_pre_checked?: boolean | null
          label: string
          section_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_pre_checked?: boolean | null
          label?: string
          section_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_template_items_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "checklist_template_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_template_sections: {
        Row: {
          created_at: string
          display_order: number
          icon: string | null
          id: string
          template_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          icon?: string | null
          id?: string
          template_id: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          icon?: string | null
          id?: string
          template_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_template_sections_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          created_at: string
          created_by: string | null
          cron_description: string | null
          cron_enabled: boolean | null
          cron_expression: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          last_generated_at: string | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          cron_description?: string | null
          cron_enabled?: boolean | null
          cron_expression?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          last_generated_at?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          cron_description?: string | null
          cron_enabled?: boolean | null
          cron_expression?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          last_generated_at?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      client_activities: {
        Row: {
          activity_type: string
          client_id: string
          created_at: string
          created_by: string | null
          description: string | null
          event_timestamp: string
          id: string
          last_sync_error: string | null
          last_synced_at: string | null
          metadata: Json | null
          related_record_id: string | null
          related_record_table: string | null
          source_actor_name: string | null
          source_actor_type: Database["public"]["Enums"]["record_source_actor_type"]
          source_details: Json
          source_reference: string | null
          source_surface: Database["public"]["Enums"]["record_source_surface"]
          sync_origin_id: string | null
          sync_origin_surface:
            | Database["public"]["Enums"]["record_source_surface"]
            | null
          sync_origin_table: string | null
          sync_status: Database["public"]["Enums"]["sync_status_type"]
          title: string
        }
        Insert: {
          activity_type: string
          client_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          event_timestamp?: string
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          metadata?: Json | null
          related_record_id?: string | null
          related_record_table?: string | null
          source_actor_name?: string | null
          source_actor_type?: Database["public"]["Enums"]["record_source_actor_type"]
          source_details?: Json
          source_reference?: string | null
          source_surface?: Database["public"]["Enums"]["record_source_surface"]
          sync_origin_id?: string | null
          sync_origin_surface?:
            | Database["public"]["Enums"]["record_source_surface"]
            | null
          sync_origin_table?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status_type"]
          title: string
        }
        Update: {
          activity_type?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          event_timestamp?: string
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          metadata?: Json | null
          related_record_id?: string | null
          related_record_table?: string | null
          source_actor_name?: string | null
          source_actor_type?: Database["public"]["Enums"]["record_source_actor_type"]
          source_details?: Json
          source_reference?: string | null
          source_surface?: Database["public"]["Enums"]["record_source_surface"]
          sync_origin_id?: string | null
          sync_origin_surface?:
            | Database["public"]["Enums"]["record_source_surface"]
            | null
          sync_origin_table?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status_type"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_activities_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_activities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_additional_contacts: {
        Row: {
          client_id: string
          country: string | null
          created_at: string
          current_address: string | null
          current_postcode: string | null
          current_state: string | null
          current_suburb: string | null
          display_order: number
          dob: string | null
          email: string | null
          first_name: string
          gender: string | null
          id: string
          living_situation: string | null
          middle_name: string | null
          mobile: string | null
          notes: string | null
          relationship: string
          residential_status: string | null
          same_address_as_primary: boolean | null
          surname: string
          updated_at: string
        }
        Insert: {
          client_id: string
          country?: string | null
          created_at?: string
          current_address?: string | null
          current_postcode?: string | null
          current_state?: string | null
          current_suburb?: string | null
          display_order?: number
          dob?: string | null
          email?: string | null
          first_name: string
          gender?: string | null
          id?: string
          living_situation?: string | null
          middle_name?: string | null
          mobile?: string | null
          notes?: string | null
          relationship?: string
          residential_status?: string | null
          same_address_as_primary?: boolean | null
          surname: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          country?: string | null
          created_at?: string
          current_address?: string | null
          current_postcode?: string | null
          current_state?: string | null
          current_suburb?: string | null
          display_order?: number
          dob?: string | null
          email?: string | null
          first_name?: string
          gender?: string | null
          id?: string
          living_situation?: string | null
          middle_name?: string | null
          mobile?: string | null
          notes?: string | null
          relationship?: string
          residential_status?: string | null
          same_address_as_primary?: boolean | null
          surname?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_additional_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_address_history: {
        Row: {
          additional_contact_id: string | null
          address: string | null
          client_id: string
          contact_type: string
          country: string | null
          created_at: string
          current_postcode: string | null
          current_state: string | null
          current_suburb: string | null
          end_date: string | null
          id: string
          is_current: boolean
          living_situation: string | null
          months_at_address: number | null
          notes: string | null
          residential_status: string | null
          start_date: string | null
          updated_at: string
        }
        Insert: {
          additional_contact_id?: string | null
          address?: string | null
          client_id: string
          contact_type?: string
          country?: string | null
          created_at?: string
          current_postcode?: string | null
          current_state?: string | null
          current_suburb?: string | null
          end_date?: string | null
          id?: string
          is_current?: boolean
          living_situation?: string | null
          months_at_address?: number | null
          notes?: string | null
          residential_status?: string | null
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          additional_contact_id?: string | null
          address?: string | null
          client_id?: string
          contact_type?: string
          country?: string | null
          created_at?: string
          current_postcode?: string | null
          current_state?: string | null
          current_suburb?: string | null
          end_date?: string | null
          id?: string
          is_current?: boolean
          living_situation?: string | null
          months_at_address?: number | null
          notes?: string | null
          residential_status?: string | null
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_address_history_additional_contact_id_fkey"
            columns: ["additional_contact_id"]
            isOneToOne: false
            referencedRelation: "client_additional_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_address_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_assets: {
        Row: {
          asset_type: string
          client_id: string
          created_at: string
          description: string | null
          id: string
          institution_name: string | null
          make_model: string | null
          updated_at: string
          value: number | null
          vehicle_type: string | null
        }
        Insert: {
          asset_type: string
          client_id: string
          created_at?: string
          description?: string | null
          id?: string
          institution_name?: string | null
          make_model?: string | null
          updated_at?: string
          value?: number | null
          vehicle_type?: string | null
        }
        Update: {
          asset_type?: string
          client_id?: string
          created_at?: string
          description?: string | null
          id?: string
          institution_name?: string | null
          make_model?: string | null
          updated_at?: string
          value?: number | null
          vehicle_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_assets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_branding_profiles: {
        Row: {
          accent_color: string | null
          client_name: string
          created_at: string | null
          created_by: string | null
          font_family: string | null
          footer_style: Json | null
          header_style: Json | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          logo_path: string | null
          primary_color: string | null
          secondary_color: string | null
          updated_at: string | null
        }
        Insert: {
          accent_color?: string | null
          client_name: string
          created_at?: string | null
          created_by?: string | null
          font_family?: string | null
          footer_style?: Json | null
          header_style?: Json | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          logo_path?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          updated_at?: string | null
        }
        Update: {
          accent_color?: string | null
          client_name?: string
          created_at?: string | null
          created_by?: string | null
          font_family?: string | null
          footer_style?: Json | null
          header_style?: Json | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          logo_path?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_branding_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_deals: {
        Row: {
          build_price: number | null
          cash_out_purpose: string | null
          cash_out_verified: boolean | null
          clawback_expiry_date: string | null
          clawback_period_months: number | null
          clawback_risk_active: boolean | null
          client_contribution_confirmed: boolean | null
          client_id: string
          commission_estimate: number | null
          conditional_approval_date: string | null
          construction_loan_type: string | null
          created_at: string
          created_by: string | null
          current_stage: string
          current_stage_number: number
          deal_type: Database["public"]["Enums"]["deal_type"]
          discharge_authority_date: string | null
          equity_released: number | null
          estimated_completion: string | null
          existing_loan_amount: number | null
          expected_build_start: string | null
          finance_clause_expiry: string | null
          finance_contact_id: string | null
          formal_approval_date: string | null
          id: string
          land_price: number | null
          land_settlement_date: string | null
          lmi_applied: boolean | null
          loan_amount: number | null
          loan_docs_signed_date: string | null
          lodgement_date: string | null
          new_loan_amount: number | null
          notes: string | null
          property_address: string | null
          property_id: string | null
          purchase_file_id: string | null
          responsible_person: string | null
          risk_status: Database["public"]["Enums"]["deal_risk_status"]
          settlement_date: string | null
          shortfall_required: number | null
          total_contract_price: number | null
          trail_commission: number | null
          updated_at: string
          valuation_completed: boolean | null
          valuation_date: string | null
        }
        Insert: {
          build_price?: number | null
          cash_out_purpose?: string | null
          cash_out_verified?: boolean | null
          clawback_expiry_date?: string | null
          clawback_period_months?: number | null
          clawback_risk_active?: boolean | null
          client_contribution_confirmed?: boolean | null
          client_id: string
          commission_estimate?: number | null
          conditional_approval_date?: string | null
          construction_loan_type?: string | null
          created_at?: string
          created_by?: string | null
          current_stage?: string
          current_stage_number?: number
          deal_type?: Database["public"]["Enums"]["deal_type"]
          discharge_authority_date?: string | null
          equity_released?: number | null
          estimated_completion?: string | null
          existing_loan_amount?: number | null
          expected_build_start?: string | null
          finance_clause_expiry?: string | null
          finance_contact_id?: string | null
          formal_approval_date?: string | null
          id?: string
          land_price?: number | null
          land_settlement_date?: string | null
          lmi_applied?: boolean | null
          loan_amount?: number | null
          loan_docs_signed_date?: string | null
          lodgement_date?: string | null
          new_loan_amount?: number | null
          notes?: string | null
          property_address?: string | null
          property_id?: string | null
          purchase_file_id?: string | null
          responsible_person?: string | null
          risk_status?: Database["public"]["Enums"]["deal_risk_status"]
          settlement_date?: string | null
          shortfall_required?: number | null
          total_contract_price?: number | null
          trail_commission?: number | null
          updated_at?: string
          valuation_completed?: boolean | null
          valuation_date?: string | null
        }
        Update: {
          build_price?: number | null
          cash_out_purpose?: string | null
          cash_out_verified?: boolean | null
          clawback_expiry_date?: string | null
          clawback_period_months?: number | null
          clawback_risk_active?: boolean | null
          client_contribution_confirmed?: boolean | null
          client_id?: string
          commission_estimate?: number | null
          conditional_approval_date?: string | null
          construction_loan_type?: string | null
          created_at?: string
          created_by?: string | null
          current_stage?: string
          current_stage_number?: number
          deal_type?: Database["public"]["Enums"]["deal_type"]
          discharge_authority_date?: string | null
          equity_released?: number | null
          estimated_completion?: string | null
          existing_loan_amount?: number | null
          expected_build_start?: string | null
          finance_clause_expiry?: string | null
          finance_contact_id?: string | null
          formal_approval_date?: string | null
          id?: string
          land_price?: number | null
          land_settlement_date?: string | null
          lmi_applied?: boolean | null
          loan_amount?: number | null
          loan_docs_signed_date?: string | null
          lodgement_date?: string | null
          new_loan_amount?: number | null
          notes?: string | null
          property_address?: string | null
          property_id?: string | null
          purchase_file_id?: string | null
          responsible_person?: string | null
          risk_status?: Database["public"]["Enums"]["deal_risk_status"]
          settlement_date?: string | null
          shortfall_required?: number | null
          total_contract_price?: number | null
          trail_commission?: number | null
          updated_at?: string
          valuation_completed?: boolean | null
          valuation_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_deals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_deals_finance_contact_id_fkey"
            columns: ["finance_contact_id"]
            isOneToOne: false
            referencedRelation: "finance_agent_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_deals_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "client_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_deals_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_deals_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      client_employment: {
        Row: {
          additional_contact_id: string | null
          allowance: number | null
          bonus: number | null
          client_id: string
          commission: number | null
          contact_type: string
          created_at: string
          employer_name: string | null
          employment_type: string | null
          gross_annual_salary: number | null
          id: string
          is_current: boolean | null
          occupation_role: string | null
          other_taxable_income: number | null
          overtime_essential: number | null
          overtime_non_essential: number | null
          salary_amount: number | null
          salary_frequency: string | null
          start_date: string | null
          updated_at: string
        }
        Insert: {
          additional_contact_id?: string | null
          allowance?: number | null
          bonus?: number | null
          client_id: string
          commission?: number | null
          contact_type?: string
          created_at?: string
          employer_name?: string | null
          employment_type?: string | null
          gross_annual_salary?: number | null
          id?: string
          is_current?: boolean | null
          occupation_role?: string | null
          other_taxable_income?: number | null
          overtime_essential?: number | null
          overtime_non_essential?: number | null
          salary_amount?: number | null
          salary_frequency?: string | null
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          additional_contact_id?: string | null
          allowance?: number | null
          bonus?: number | null
          client_id?: string
          commission?: number | null
          contact_type?: string
          created_at?: string
          employer_name?: string | null
          employment_type?: string | null
          gross_annual_salary?: number | null
          id?: string
          is_current?: boolean | null
          occupation_role?: string | null
          other_taxable_income?: number | null
          overtime_essential?: number | null
          overtime_non_essential?: number | null
          salary_amount?: number | null
          salary_frequency?: string | null
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_employment_additional_contact_id_fkey"
            columns: ["additional_contact_id"]
            isOneToOne: false
            referencedRelation: "client_additional_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_employment_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_expenses: {
        Row: {
          client_id: string
          created_at: string
          expense_category: string
          expense_name: string | null
          frequency: string | null
          id: string
          is_essential: boolean | null
          monthly_amount: number
          notes: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          expense_category: string
          expense_name?: string | null
          frequency?: string | null
          id?: string
          is_essential?: boolean | null
          monthly_amount?: number
          notes?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          expense_category?: string
          expense_name?: string | null
          frequency?: string | null
          id?: string
          is_essential?: boolean | null
          monthly_amount?: number
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_expenses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_files: {
        Row: {
          category: string
          client_id: string
          content_hash: string | null
          dedupe_key: string | null
          description: string | null
          document_type: string | null
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          is_vownet_form: boolean | null
          last_sync_error: string | null
          last_synced_at: string | null
          report_type: string | null
          source_actor_name: string | null
          source_actor_type: Database["public"]["Enums"]["record_source_actor_type"]
          source_details: Json
          source_reference: string | null
          source_surface: Database["public"]["Enums"]["record_source_surface"]
          supersedes_file_id: string | null
          sync_origin_id: string | null
          sync_origin_surface:
            | Database["public"]["Enums"]["record_source_surface"]
            | null
          sync_origin_table: string | null
          sync_status: Database["public"]["Enums"]["sync_status_type"]
          uploaded_at: string
          uploaded_by: string | null
          version_group_id: string | null
          version_number: number
        }
        Insert: {
          category?: string
          client_id: string
          content_hash?: string | null
          dedupe_key?: string | null
          description?: string | null
          document_type?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          is_vownet_form?: boolean | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          report_type?: string | null
          source_actor_name?: string | null
          source_actor_type?: Database["public"]["Enums"]["record_source_actor_type"]
          source_details?: Json
          source_reference?: string | null
          source_surface?: Database["public"]["Enums"]["record_source_surface"]
          supersedes_file_id?: string | null
          sync_origin_id?: string | null
          sync_origin_surface?:
            | Database["public"]["Enums"]["record_source_surface"]
            | null
          sync_origin_table?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status_type"]
          uploaded_at?: string
          uploaded_by?: string | null
          version_group_id?: string | null
          version_number?: number
        }
        Update: {
          category?: string
          client_id?: string
          content_hash?: string | null
          dedupe_key?: string | null
          description?: string | null
          document_type?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          is_vownet_form?: boolean | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          report_type?: string | null
          source_actor_name?: string | null
          source_actor_type?: Database["public"]["Enums"]["record_source_actor_type"]
          source_details?: Json
          source_reference?: string | null
          source_surface?: Database["public"]["Enums"]["record_source_surface"]
          supersedes_file_id?: string | null
          sync_origin_id?: string | null
          sync_origin_surface?:
            | Database["public"]["Enums"]["record_source_surface"]
            | null
          sync_origin_table?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status_type"]
          uploaded_at?: string
          uploaded_by?: string | null
          version_group_id?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_files_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_import_logs: {
        Row: {
          clients_created: number | null
          completed_at: string | null
          created_at: string
          errors: Json | null
          file_name: string
          id: string
          imported_by: string | null
          properties_created: number | null
          status: string
        }
        Insert: {
          clients_created?: number | null
          completed_at?: string | null
          created_at?: string
          errors?: Json | null
          file_name: string
          id?: string
          imported_by?: string | null
          properties_created?: number | null
          status?: string
        }
        Update: {
          clients_created?: number | null
          completed_at?: string | null
          created_at?: string
          errors?: Json | null
          file_name?: string
          id?: string
          imported_by?: string | null
          properties_created?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_import_logs_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_income: {
        Row: {
          allowance: number | null
          bonus: number | null
          client_id: string
          commission: number | null
          contact_type: string
          created_at: string
          gross_salary: number | null
          id: string
          other_taxable_income: number | null
          overtime_essential: number | null
          overtime_non_essential: number | null
          salary_frequency: string | null
          updated_at: string
        }
        Insert: {
          allowance?: number | null
          bonus?: number | null
          client_id: string
          commission?: number | null
          contact_type?: string
          created_at?: string
          gross_salary?: number | null
          id?: string
          other_taxable_income?: number | null
          overtime_essential?: number | null
          overtime_non_essential?: number | null
          salary_frequency?: string | null
          updated_at?: string
        }
        Update: {
          allowance?: number | null
          bonus?: number | null
          client_id?: string
          commission?: number | null
          contact_type?: string
          created_at?: string
          gross_salary?: number | null
          id?: string
          other_taxable_income?: number | null
          overtime_essential?: number | null
          overtime_non_essential?: number | null
          salary_frequency?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_income_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_income_sources: {
        Row: {
          additional_contact_id: string | null
          allowance: number | null
          bonus: number | null
          client_id: string
          commission: number | null
          contact_type: string
          created_at: string
          custom_shading_rate: number | null
          default_shading_rate: number
          display_order: number
          employment_id: string | null
          gross_annual_amount: number
          id: string
          input_amount: number
          input_frequency: string
          is_active: boolean
          notes: string | null
          other_taxable_income: number | null
          overtime_essential: number | null
          overtime_non_essential: number | null
          source_category: string
          source_name: string | null
          source_type: string
          updated_at: string
        }
        Insert: {
          additional_contact_id?: string | null
          allowance?: number | null
          bonus?: number | null
          client_id: string
          commission?: number | null
          contact_type?: string
          created_at?: string
          custom_shading_rate?: number | null
          default_shading_rate?: number
          display_order?: number
          employment_id?: string | null
          gross_annual_amount?: number
          id?: string
          input_amount?: number
          input_frequency?: string
          is_active?: boolean
          notes?: string | null
          other_taxable_income?: number | null
          overtime_essential?: number | null
          overtime_non_essential?: number | null
          source_category?: string
          source_name?: string | null
          source_type?: string
          updated_at?: string
        }
        Update: {
          additional_contact_id?: string | null
          allowance?: number | null
          bonus?: number | null
          client_id?: string
          commission?: number | null
          contact_type?: string
          created_at?: string
          custom_shading_rate?: number | null
          default_shading_rate?: number
          display_order?: number
          employment_id?: string | null
          gross_annual_amount?: number
          id?: string
          input_amount?: number
          input_frequency?: string
          is_active?: boolean
          notes?: string | null
          other_taxable_income?: number | null
          overtime_essential?: number | null
          overtime_non_essential?: number | null
          source_category?: string
          source_name?: string | null
          source_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_income_sources_additional_contact_id_fkey"
            columns: ["additional_contact_id"]
            isOneToOne: false
            referencedRelation: "client_additional_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_income_sources_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_income_sources_employment_id_fkey"
            columns: ["employment_id"]
            isOneToOne: false
            referencedRelation: "client_employment"
            referencedColumns: ["id"]
          },
        ]
      }
      client_liabilities: {
        Row: {
          client_id: string
          created_at: string
          credit_limit: number | null
          current_balance: number | null
          id: string
          interest_rate: number | null
          liability_type: string
          monthly_repayment: number | null
          provider_name: string | null
          repayment_type: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          credit_limit?: number | null
          current_balance?: number | null
          id?: string
          interest_rate?: number | null
          liability_type: string
          monthly_repayment?: number | null
          provider_name?: string | null
          repayment_type?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          credit_limit?: number | null
          current_balance?: number | null
          id?: string
          interest_rate?: number | null
          liability_type?: string
          monthly_repayment?: number | null
          provider_name?: string | null
          repayment_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_liabilities_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_notes: {
        Row: {
          client_id: string
          content: string
          content_hash: string | null
          created_at: string
          created_by: string | null
          dedupe_key: string | null
          ghl_note_id: string | null
          id: string
          last_sync_error: string | null
          last_synced_at: string | null
          note_type: string
          source_actor_name: string | null
          source_actor_type: Database["public"]["Enums"]["record_source_actor_type"]
          source_details: Json
          source_reference: string | null
          source_surface: Database["public"]["Enums"]["record_source_surface"]
          supersedes_note_id: string | null
          sync_origin_id: string | null
          sync_origin_surface:
            | Database["public"]["Enums"]["record_source_surface"]
            | null
          sync_origin_table: string | null
          sync_status: Database["public"]["Enums"]["sync_status_type"]
          updated_at: string
          version_group_id: string | null
          version_number: number
          visibility: Database["public"]["Enums"]["client_note_visibility"]
        }
        Insert: {
          client_id: string
          content: string
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          dedupe_key?: string | null
          ghl_note_id?: string | null
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          note_type?: string
          source_actor_name?: string | null
          source_actor_type?: Database["public"]["Enums"]["record_source_actor_type"]
          source_details?: Json
          source_reference?: string | null
          source_surface?: Database["public"]["Enums"]["record_source_surface"]
          supersedes_note_id?: string | null
          sync_origin_id?: string | null
          sync_origin_surface?:
            | Database["public"]["Enums"]["record_source_surface"]
            | null
          sync_origin_table?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status_type"]
          updated_at?: string
          version_group_id?: string | null
          version_number?: number
          visibility?: Database["public"]["Enums"]["client_note_visibility"]
        }
        Update: {
          client_id?: string
          content?: string
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          dedupe_key?: string | null
          ghl_note_id?: string | null
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          note_type?: string
          source_actor_name?: string | null
          source_actor_type?: Database["public"]["Enums"]["record_source_actor_type"]
          source_details?: Json
          source_reference?: string | null
          source_surface?: Database["public"]["Enums"]["record_source_surface"]
          supersedes_note_id?: string | null
          sync_origin_id?: string | null
          sync_origin_surface?:
            | Database["public"]["Enums"]["record_source_surface"]
            | null
          sync_origin_table?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status_type"]
          updated_at?: string
          version_group_id?: string | null
          version_number?: number
          visibility?: Database["public"]["Enums"]["client_note_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portal_messages: {
        Row: {
          allocated_finance_user_id: string | null
          allocation_status: Database["public"]["Enums"]["message_allocation_status"]
          client_id: string
          command_owner_user_id: string | null
          created_at: string | null
          finance_allocated: boolean
          id: string
          is_internal: boolean
          is_read: boolean | null
          message: string
          notification_status: Json
          permission_status: Json
          portal_user_id: string | null
          read_at: string | null
          sender_name: string | null
          sender_type: string
          thread_id: string | null
          thread_type: string
          updated_at: string | null
          visibility_scope: Database["public"]["Enums"]["message_visibility_scope"]
        }
        Insert: {
          allocated_finance_user_id?: string | null
          allocation_status?: Database["public"]["Enums"]["message_allocation_status"]
          client_id: string
          command_owner_user_id?: string | null
          created_at?: string | null
          finance_allocated?: boolean
          id?: string
          is_internal?: boolean
          is_read?: boolean | null
          message: string
          notification_status?: Json
          permission_status?: Json
          portal_user_id?: string | null
          read_at?: string | null
          sender_name?: string | null
          sender_type: string
          thread_id?: string | null
          thread_type?: string
          updated_at?: string | null
          visibility_scope?: Database["public"]["Enums"]["message_visibility_scope"]
        }
        Update: {
          allocated_finance_user_id?: string | null
          allocation_status?: Database["public"]["Enums"]["message_allocation_status"]
          client_id?: string
          command_owner_user_id?: string | null
          created_at?: string | null
          finance_allocated?: boolean
          id?: string
          is_internal?: boolean
          is_read?: boolean | null
          message?: string
          notification_status?: Json
          permission_status?: Json
          portal_user_id?: string | null
          read_at?: string | null
          sender_name?: string | null
          sender_type?: string
          thread_id?: string | null
          thread_type?: string
          updated_at?: string | null
          visibility_scope?: Database["public"]["Enums"]["message_visibility_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_messages_allocated_finance_user_id_fkey"
            columns: ["allocated_finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_messages_command_owner_user_id_fkey"
            columns: ["command_owner_user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_messages_portal_user_id_fkey"
            columns: ["portal_user_id"]
            isOneToOne: false
            referencedRelation: "client_portal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portal_notifications: {
        Row: {
          action_url: string | null
          category: string | null
          client_id: string
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string | null
          metadata: Json | null
          read_at: string | null
          title: string
          type: string | null
        }
        Insert: {
          action_url?: string | null
          category?: string | null
          client_id: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string | null
          metadata?: Json | null
          read_at?: string | null
          title: string
          type?: string | null
        }
        Update: {
          action_url?: string | null
          category?: string | null
          client_id?: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string | null
          metadata?: Json | null
          read_at?: string | null
          title?: string
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_notifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portal_report_requests: {
        Row: {
          admin_notes: string | null
          assigned_to: string | null
          client_id: string
          client_property_id: string | null
          created_at: string
          fulfilled_report_id: string | null
          id: string
          notes: string | null
          portal_user_id: string | null
          property_address: string | null
          request_type: Database["public"]["Enums"]["portal_report_request_type"]
          status: Database["public"]["Enums"]["portal_report_request_status"]
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          assigned_to?: string | null
          client_id: string
          client_property_id?: string | null
          created_at?: string
          fulfilled_report_id?: string | null
          id?: string
          notes?: string | null
          portal_user_id?: string | null
          property_address?: string | null
          request_type: Database["public"]["Enums"]["portal_report_request_type"]
          status?: Database["public"]["Enums"]["portal_report_request_status"]
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          assigned_to?: string | null
          client_id?: string
          client_property_id?: string | null
          created_at?: string
          fulfilled_report_id?: string | null
          id?: string
          notes?: string | null
          portal_user_id?: string | null
          property_address?: string | null
          request_type?: Database["public"]["Enums"]["portal_report_request_type"]
          status?: Database["public"]["Enums"]["portal_report_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_report_requests_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_report_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_report_requests_client_property_id_fkey"
            columns: ["client_property_id"]
            isOneToOne: false
            referencedRelation: "client_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_report_requests_portal_user_id_fkey"
            columns: ["portal_user_id"]
            isOneToOne: false
            referencedRelation: "client_portal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portal_reports: {
        Row: {
          client_id: string
          client_visible_notes: string | null
          created_at: string
          file_size_bytes: number | null
          id: string
          is_read: boolean
          notes: string | null
          published_at: string
          published_by: string | null
          read_at: string | null
          report_tier: string | null
          report_title: string
          report_type: string
          source_report_id: string | null
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          client_visible_notes?: string | null
          created_at?: string
          file_size_bytes?: number | null
          id?: string
          is_read?: boolean
          notes?: string | null
          published_at?: string
          published_by?: string | null
          read_at?: string | null
          report_tier?: string | null
          report_title: string
          report_type?: string
          source_report_id?: string | null
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          client_visible_notes?: string | null
          created_at?: string
          file_size_bytes?: number | null
          id?: string
          is_read?: boolean
          notes?: string | null
          published_at?: string
          published_by?: string | null
          read_at?: string | null
          report_tier?: string | null
          report_title?: string
          report_type?: string
          source_report_id?: string | null
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portal_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          idle_expires_at: string | null
          impersonator_finance_contact_id: string | null
          impersonator_finance_user_id: string | null
          impersonator_staff_user_id: string | null
          ip_address: string | null
          is_readonly: boolean
          last_used_at: string | null
          portal_scope: string
          revocation_reason: string | null
          revoked_at: string | null
          rotated_from_session_id: string | null
          session_token: string
          token_hash: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          idle_expires_at?: string | null
          impersonator_finance_contact_id?: string | null
          impersonator_finance_user_id?: string | null
          impersonator_staff_user_id?: string | null
          ip_address?: string | null
          is_readonly?: boolean
          last_used_at?: string | null
          portal_scope?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          rotated_from_session_id?: string | null
          session_token: string
          token_hash?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          idle_expires_at?: string | null
          impersonator_finance_contact_id?: string | null
          impersonator_finance_user_id?: string | null
          impersonator_staff_user_id?: string | null
          ip_address?: string | null
          is_readonly?: boolean
          last_used_at?: string | null
          portal_scope?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          rotated_from_session_id?: string | null
          session_token?: string
          token_hash?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_sessions_impersonator_finance_user_id_fkey"
            columns: ["impersonator_finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "client_portal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portal_users: {
        Row: {
          client_id: string
          created_at: string
          email: string
          failed_login_attempts: number
          has_accepted_terms: boolean
          has_completed_onboarding: boolean
          id: string
          invite_expires_at: string | null
          invite_token: string | null
          last_login_at: string | null
          locked_until: string | null
          password_hash: string
          password_reset_attempts: number
          password_reset_expires_at: string | null
          password_reset_token: string | null
          status: string
          terms_accepted_at: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          email: string
          failed_login_attempts?: number
          has_accepted_terms?: boolean
          has_completed_onboarding?: boolean
          id?: string
          invite_expires_at?: string | null
          invite_token?: string | null
          last_login_at?: string | null
          locked_until?: string | null
          password_hash: string
          password_reset_attempts?: number
          password_reset_expires_at?: string | null
          password_reset_token?: string | null
          status?: string
          terms_accepted_at?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          email?: string
          failed_login_attempts?: number
          has_accepted_terms?: boolean
          has_completed_onboarding?: boolean
          id?: string
          invite_expires_at?: string | null
          invite_token?: string | null
          last_login_at?: string | null
          locked_until?: string | null
          password_hash?: string
          password_reset_attempts?: number
          password_reset_expires_at?: string | null
          password_reset_token?: string | null
          status?: string
          terms_accepted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_users_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_properties: {
        Row: {
          address: string
          client_id: string
          created_at: string
          deal_closed_at: string | null
          id: string
          interest_only_period_years: number | null
          interest_rate: number | null
          lender_name: string | null
          loan_remaining: number | null
          loan_repayment_amount: number | null
          loan_repayment_frequency: string | null
          monthly_body_corporate: number | null
          monthly_building_insurance: number | null
          monthly_council_rates: number | null
          monthly_interest_repayment: number | null
          monthly_landlord_insurance: number | null
          monthly_property_management: number | null
          monthly_rental_income: number | null
          monthly_repairs_maintenance: number | null
          monthly_water_rates: number | null
          net_monthly_cashflow: number | null
          ownership_percentage: number | null
          property_type: string
          purchase_date: string | null
          purchase_price: number | null
          repayment_type: string | null
          smsf_abn: string | null
          smsf_auditor_name: string | null
          smsf_compliance_status: string | null
          smsf_fund_name: string | null
          smsf_trustee_name: string | null
          smsf_trustee_type: string | null
          sourced_by: string
          sourced_notes: string | null
          total_monthly_expenditure: number | null
          updated_at: string
          value: number | null
          weekly_rental_income: number | null
        }
        Insert: {
          address: string
          client_id: string
          created_at?: string
          deal_closed_at?: string | null
          id?: string
          interest_only_period_years?: number | null
          interest_rate?: number | null
          lender_name?: string | null
          loan_remaining?: number | null
          loan_repayment_amount?: number | null
          loan_repayment_frequency?: string | null
          monthly_body_corporate?: number | null
          monthly_building_insurance?: number | null
          monthly_council_rates?: number | null
          monthly_interest_repayment?: number | null
          monthly_landlord_insurance?: number | null
          monthly_property_management?: number | null
          monthly_rental_income?: number | null
          monthly_repairs_maintenance?: number | null
          monthly_water_rates?: number | null
          net_monthly_cashflow?: number | null
          ownership_percentage?: number | null
          property_type?: string
          purchase_date?: string | null
          purchase_price?: number | null
          repayment_type?: string | null
          smsf_abn?: string | null
          smsf_auditor_name?: string | null
          smsf_compliance_status?: string | null
          smsf_fund_name?: string | null
          smsf_trustee_name?: string | null
          smsf_trustee_type?: string | null
          sourced_by?: string
          sourced_notes?: string | null
          total_monthly_expenditure?: number | null
          updated_at?: string
          value?: number | null
          weekly_rental_income?: number | null
        }
        Update: {
          address?: string
          client_id?: string
          created_at?: string
          deal_closed_at?: string | null
          id?: string
          interest_only_period_years?: number | null
          interest_rate?: number | null
          lender_name?: string | null
          loan_remaining?: number | null
          loan_repayment_amount?: number | null
          loan_repayment_frequency?: string | null
          monthly_body_corporate?: number | null
          monthly_building_insurance?: number | null
          monthly_council_rates?: number | null
          monthly_interest_repayment?: number | null
          monthly_landlord_insurance?: number | null
          monthly_property_management?: number | null
          monthly_rental_income?: number | null
          monthly_repairs_maintenance?: number | null
          monthly_water_rates?: number | null
          net_monthly_cashflow?: number | null
          ownership_percentage?: number | null
          property_type?: string
          purchase_date?: string | null
          purchase_price?: number | null
          repayment_type?: string | null
          smsf_abn?: string | null
          smsf_auditor_name?: string | null
          smsf_compliance_status?: string | null
          smsf_fund_name?: string | null
          smsf_trustee_name?: string | null
          smsf_trustee_type?: string | null
          sourced_by?: string
          sourced_notes?: string | null
          total_monthly_expenditure?: number | null
          updated_at?: string
          value?: number | null
          weekly_rental_income?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "client_properties_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_qa_memory: {
        Row: {
          client_id: string
          content: string
          content_hash: string | null
          created_at: string
          id: string
          importance: number
          kind: string
          source_conversation_id: string | null
          source_message_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          client_id: string
          content: string
          content_hash?: string | null
          created_at?: string
          id?: string
          importance?: number
          kind: string
          source_conversation_id?: string | null
          source_message_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          client_id?: string
          content?: string
          content_hash?: string | null
          created_at?: string
          id?: string
          importance?: number
          kind?: string
          source_conversation_id?: string | null
          source_message_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      client_reminders: {
        Row: {
          assigned_to: string[] | null
          client_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string
          id: string
          priority: string
          reminder_scope: string
          reminder_type: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string[] | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date: string
          id?: string
          priority?: string
          reminder_scope?: string
          reminder_type?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string[] | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string
          id?: string
          priority?: string
          reminder_scope?: string
          reminder_type?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_reminders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_reminders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_scores: {
        Row: {
          calculation_notes: string | null
          cash_flow_score: number
          client_id: string
          growth_potential: number
          id: string
          last_calculated_at: string
          overall_score: number
          portfolio_health: number
          risk_factors: Json | null
          risk_level: string
        }
        Insert: {
          calculation_notes?: string | null
          cash_flow_score?: number
          client_id: string
          growth_potential?: number
          id?: string
          last_calculated_at?: string
          overall_score?: number
          portfolio_health?: number
          risk_factors?: Json | null
          risk_level?: string
        }
        Update: {
          calculation_notes?: string | null
          cash_flow_score?: number
          client_id?: string
          growth_potential?: number
          id?: string
          last_calculated_at?: string
          overall_score?: number
          portfolio_health?: number
          risk_factors?: Json | null
          risk_level?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_scores_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_sync_events: {
        Row: {
          client_id: string
          conflict_group: string | null
          conflict_reason: string | null
          content_hash: string | null
          created_at: string
          dedupe_key: string | null
          entity_id: string
          entity_table: string
          entity_type: string
          id: string
          propagated_to: Json
          source_actor_name: string | null
          source_actor_type: Database["public"]["Enums"]["record_source_actor_type"]
          source_details: Json
          source_reference: string | null
          source_surface: Database["public"]["Enums"]["record_source_surface"]
          supersedes_entity_id: string | null
          sync_status: Database["public"]["Enums"]["sync_status_type"]
          updated_at: string
          version_group_id: string | null
          version_number: number
        }
        Insert: {
          client_id: string
          conflict_group?: string | null
          conflict_reason?: string | null
          content_hash?: string | null
          created_at?: string
          dedupe_key?: string | null
          entity_id: string
          entity_table: string
          entity_type: string
          id?: string
          propagated_to?: Json
          source_actor_name?: string | null
          source_actor_type: Database["public"]["Enums"]["record_source_actor_type"]
          source_details?: Json
          source_reference?: string | null
          source_surface: Database["public"]["Enums"]["record_source_surface"]
          supersedes_entity_id?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status_type"]
          updated_at?: string
          version_group_id?: string | null
          version_number?: number
        }
        Update: {
          client_id?: string
          conflict_group?: string | null
          conflict_reason?: string | null
          content_hash?: string | null
          created_at?: string
          dedupe_key?: string | null
          entity_id?: string
          entity_table?: string
          entity_type?: string
          id?: string
          propagated_to?: Json
          source_actor_name?: string | null
          source_actor_type?: Database["public"]["Enums"]["record_source_actor_type"]
          source_details?: Json
          source_reference?: string | null
          source_surface?: Database["public"]["Enums"]["record_source_surface"]
          supersedes_entity_id?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status_type"]
          updated_at?: string
          version_group_id?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_sync_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tag_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          client_id: string
          id: string
          tag_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          client_id: string
          id?: string
          tag_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          client_id?: string
          id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tag_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tag_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "client_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tags: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          assigned_team_user_id: string | null
          borrowing_capacity: number | null
          country: string | null
          created_at: string
          created_by: string | null
          current_address: string | null
          current_pipeline_id: string | null
          current_postcode: string | null
          current_stage_id: string | null
          current_state: string | null
          current_suburb: string | null
          deal_status: string
          dependents_count: number | null
          equity_release: number | null
          finance_contact_id: string | null
          first_deal_closed_at: string | null
          follow_up_date: string | null
          ghl_contact_id: string | null
          ghl_last_synced_at: string | null
          ghl_opportunity_id: string | null
          ghl_sync_status: string | null
          id: string
          is_active: boolean | null
          is_favorite: boolean
          last_note_at: string | null
          last_review_date: string | null
          lead_source: string | null
          lead_source_campaign: string | null
          lead_source_detail: string | null
          living_situation: string | null
          marital_status: string | null
          net_monthly_cash_flow: number | null
          next_review_due: string | null
          notes: string | null
          opportunity_status: string | null
          pipeline_notes: string | null
          pipeline_status: string | null
          pipeline_updated_at: string | null
          primary_dob: string | null
          primary_email: string | null
          primary_first_name: string
          primary_gender: string | null
          primary_middle_name: string | null
          primary_mobile: string | null
          primary_surname: string
          proposed_rental_income: number | null
          residential_status: string | null
          review_frequency: string | null
          secondary_country: string | null
          secondary_current_address: string | null
          secondary_current_postcode: string | null
          secondary_current_state: string | null
          secondary_current_suburb: string | null
          secondary_dob: string | null
          secondary_email: string | null
          secondary_first_name: string | null
          secondary_gender: string | null
          secondary_living_situation: string | null
          secondary_middle_name: string | null
          secondary_mobile: string | null
          secondary_residential_status: string | null
          secondary_same_address_as_primary: boolean | null
          secondary_surname: string | null
          total_debt: number | null
          total_monthly_expenditure: number | null
          total_monthly_income: number | null
          total_monthly_rental_income: number | null
          total_portfolio_value: number | null
          updated_at: string
        }
        Insert: {
          assigned_team_user_id?: string | null
          borrowing_capacity?: number | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          current_address?: string | null
          current_pipeline_id?: string | null
          current_postcode?: string | null
          current_stage_id?: string | null
          current_state?: string | null
          current_suburb?: string | null
          deal_status?: string
          dependents_count?: number | null
          equity_release?: number | null
          finance_contact_id?: string | null
          first_deal_closed_at?: string | null
          follow_up_date?: string | null
          ghl_contact_id?: string | null
          ghl_last_synced_at?: string | null
          ghl_opportunity_id?: string | null
          ghl_sync_status?: string | null
          id?: string
          is_active?: boolean | null
          is_favorite?: boolean
          last_note_at?: string | null
          last_review_date?: string | null
          lead_source?: string | null
          lead_source_campaign?: string | null
          lead_source_detail?: string | null
          living_situation?: string | null
          marital_status?: string | null
          net_monthly_cash_flow?: number | null
          next_review_due?: string | null
          notes?: string | null
          opportunity_status?: string | null
          pipeline_notes?: string | null
          pipeline_status?: string | null
          pipeline_updated_at?: string | null
          primary_dob?: string | null
          primary_email?: string | null
          primary_first_name: string
          primary_gender?: string | null
          primary_middle_name?: string | null
          primary_mobile?: string | null
          primary_surname: string
          proposed_rental_income?: number | null
          residential_status?: string | null
          review_frequency?: string | null
          secondary_country?: string | null
          secondary_current_address?: string | null
          secondary_current_postcode?: string | null
          secondary_current_state?: string | null
          secondary_current_suburb?: string | null
          secondary_dob?: string | null
          secondary_email?: string | null
          secondary_first_name?: string | null
          secondary_gender?: string | null
          secondary_living_situation?: string | null
          secondary_middle_name?: string | null
          secondary_mobile?: string | null
          secondary_residential_status?: string | null
          secondary_same_address_as_primary?: boolean | null
          secondary_surname?: string | null
          total_debt?: number | null
          total_monthly_expenditure?: number | null
          total_monthly_income?: number | null
          total_monthly_rental_income?: number | null
          total_portfolio_value?: number | null
          updated_at?: string
        }
        Update: {
          assigned_team_user_id?: string | null
          borrowing_capacity?: number | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          current_address?: string | null
          current_pipeline_id?: string | null
          current_postcode?: string | null
          current_stage_id?: string | null
          current_state?: string | null
          current_suburb?: string | null
          deal_status?: string
          dependents_count?: number | null
          equity_release?: number | null
          finance_contact_id?: string | null
          first_deal_closed_at?: string | null
          follow_up_date?: string | null
          ghl_contact_id?: string | null
          ghl_last_synced_at?: string | null
          ghl_opportunity_id?: string | null
          ghl_sync_status?: string | null
          id?: string
          is_active?: boolean | null
          is_favorite?: boolean
          last_note_at?: string | null
          last_review_date?: string | null
          lead_source?: string | null
          lead_source_campaign?: string | null
          lead_source_detail?: string | null
          living_situation?: string | null
          marital_status?: string | null
          net_monthly_cash_flow?: number | null
          next_review_due?: string | null
          notes?: string | null
          opportunity_status?: string | null
          pipeline_notes?: string | null
          pipeline_status?: string | null
          pipeline_updated_at?: string | null
          primary_dob?: string | null
          primary_email?: string | null
          primary_first_name?: string
          primary_gender?: string | null
          primary_middle_name?: string | null
          primary_mobile?: string | null
          primary_surname?: string
          proposed_rental_income?: number | null
          residential_status?: string | null
          review_frequency?: string | null
          secondary_country?: string | null
          secondary_current_address?: string | null
          secondary_current_postcode?: string | null
          secondary_current_state?: string | null
          secondary_current_suburb?: string | null
          secondary_dob?: string | null
          secondary_email?: string | null
          secondary_first_name?: string | null
          secondary_gender?: string | null
          secondary_living_situation?: string | null
          secondary_middle_name?: string | null
          secondary_mobile?: string | null
          secondary_residential_status?: string | null
          secondary_same_address_as_primary?: boolean | null
          secondary_surname?: string | null
          total_debt?: number | null
          total_monthly_expenditure?: number | null
          total_monthly_income?: number | null
          total_monthly_rental_income?: number | null
          total_portfolio_value?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_assigned_team_user_id_fkey"
            columns: ["assigned_team_user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_current_pipeline_id_fkey"
            columns: ["current_pipeline_id"]
            isOneToOne: false
            referencedRelation: "ghl_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_current_stage_id_fkey"
            columns: ["current_stage_id"]
            isOneToOne: false
            referencedRelation: "ghl_pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_finance_contact_id_fkey"
            columns: ["finance_contact_id"]
            isOneToOne: false
            referencedRelation: "finance_agent_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      climate_data_cache: {
        Row: {
          climate_zone: string | null
          created_at: string
          data_quality: string
          expires_at: string
          extreme_weather: Json | null
          fetched_at: string
          humidity_data: Json | null
          id: string
          postcode: string | null
          projections: Json | null
          rainfall_data: Json | null
          state: string
          suburb: string | null
          temperature_data: Json | null
        }
        Insert: {
          climate_zone?: string | null
          created_at?: string
          data_quality?: string
          expires_at?: string
          extreme_weather?: Json | null
          fetched_at?: string
          humidity_data?: Json | null
          id?: string
          postcode?: string | null
          projections?: Json | null
          rainfall_data?: Json | null
          state: string
          suburb?: string | null
          temperature_data?: Json | null
        }
        Update: {
          climate_zone?: string | null
          created_at?: string
          data_quality?: string
          expires_at?: string
          extreme_weather?: Json | null
          fetched_at?: string
          humidity_data?: Json | null
          id?: string
          postcode?: string | null
          projections?: Json | null
          rainfall_data?: Json | null
          state?: string
          suburb?: string | null
          temperature_data?: Json | null
        }
        Relationships: []
      }
      commercial_capex: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          id: string
          notes: string | null
          property_id: string
          updated_at: string
          year: number
        }
        Insert: {
          amount?: number
          category?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          property_id: string
          updated_at?: string
          year: number
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          property_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "commercial_capex_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "commercial_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_dcf_runs: {
        Row: {
          capex_schedule: Json
          created_at: string
          discount_rate: number
          equity_multiple: number | null
          hold_period_years: number
          id: string
          interest_rate: number | null
          irr: number | null
          loan_amount: number | null
          loan_term_years: number | null
          npv: number | null
          outputs: Json
          peak_equity: number | null
          property_id: string
          rental_growth_assumptions: Json
          scenario_name: string
          terminal_cap_rate: number
          updated_at: string
          user_id: string
          vacancy_allowance_pct: number
        }
        Insert: {
          capex_schedule?: Json
          created_at?: string
          discount_rate?: number
          equity_multiple?: number | null
          hold_period_years?: number
          id?: string
          interest_rate?: number | null
          irr?: number | null
          loan_amount?: number | null
          loan_term_years?: number | null
          npv?: number | null
          outputs?: Json
          peak_equity?: number | null
          property_id: string
          rental_growth_assumptions?: Json
          scenario_name?: string
          terminal_cap_rate?: number
          updated_at?: string
          user_id: string
          vacancy_allowance_pct?: number
        }
        Update: {
          capex_schedule?: Json
          created_at?: string
          discount_rate?: number
          equity_multiple?: number | null
          hold_period_years?: number
          id?: string
          interest_rate?: number | null
          irr?: number | null
          loan_amount?: number | null
          loan_term_years?: number | null
          npv?: number | null
          outputs?: Json
          peak_equity?: number | null
          property_id?: string
          rental_growth_assumptions?: Json
          scenario_name?: string
          terminal_cap_rate?: number
          updated_at?: string
          user_id?: string
          vacancy_allowance_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "commercial_dcf_runs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "commercial_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_financing: {
        Row: {
          created_at: string
          id: string
          interest_rate: number | null
          io_period_years: number | null
          lender: string | null
          loan_amount: number | null
          loan_balance: number | null
          loan_term_years: number | null
          lvr_pct: number | null
          notes: string | null
          ongoing_fees_pa: number | null
          property_id: string
          rate_type: string | null
          repayment_type: string | null
          updated_at: string
          upfront_fees: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          interest_rate?: number | null
          io_period_years?: number | null
          lender?: string | null
          loan_amount?: number | null
          loan_balance?: number | null
          loan_term_years?: number | null
          lvr_pct?: number | null
          notes?: string | null
          ongoing_fees_pa?: number | null
          property_id: string
          rate_type?: string | null
          repayment_type?: string | null
          updated_at?: string
          upfront_fees?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          interest_rate?: number | null
          io_period_years?: number | null
          lender?: string | null
          loan_amount?: number | null
          loan_balance?: number | null
          loan_term_years?: number | null
          lvr_pct?: number | null
          notes?: string | null
          ongoing_fees_pa?: number | null
          property_id?: string
          rate_type?: string | null
          repayment_type?: string | null
          updated_at?: string
          upfront_fees?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "commercial_financing_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "commercial_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_leases: {
        Row: {
          base_rent_pa: number
          cash_incentive: number | null
          created_at: string
          fitout_contribution: number | null
          id: string
          lease_end: string | null
          lease_start: string | null
          next_review_date: string | null
          nla_sqm: number | null
          notes: string | null
          option_terms: Json
          outgoings_recovery_pct: number | null
          property_id: string
          rent_basis: Database["public"]["Enums"]["commercial_rent_basis"]
          rent_free_months: number | null
          review_amount: number | null
          review_freq_months: number | null
          review_type: Database["public"]["Enums"]["commercial_review_type"]
          security_amount: number | null
          security_type: Database["public"]["Enums"]["commercial_security_type"]
          status: Database["public"]["Enums"]["commercial_lease_status"]
          suite_unit: string | null
          tenant_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          base_rent_pa?: number
          cash_incentive?: number | null
          created_at?: string
          fitout_contribution?: number | null
          id?: string
          lease_end?: string | null
          lease_start?: string | null
          next_review_date?: string | null
          nla_sqm?: number | null
          notes?: string | null
          option_terms?: Json
          outgoings_recovery_pct?: number | null
          property_id: string
          rent_basis?: Database["public"]["Enums"]["commercial_rent_basis"]
          rent_free_months?: number | null
          review_amount?: number | null
          review_freq_months?: number | null
          review_type?: Database["public"]["Enums"]["commercial_review_type"]
          security_amount?: number | null
          security_type?: Database["public"]["Enums"]["commercial_security_type"]
          status?: Database["public"]["Enums"]["commercial_lease_status"]
          suite_unit?: string | null
          tenant_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          base_rent_pa?: number
          cash_incentive?: number | null
          created_at?: string
          fitout_contribution?: number | null
          id?: string
          lease_end?: string | null
          lease_start?: string | null
          next_review_date?: string | null
          nla_sqm?: number | null
          notes?: string | null
          option_terms?: Json
          outgoings_recovery_pct?: number | null
          property_id?: string
          rent_basis?: Database["public"]["Enums"]["commercial_rent_basis"]
          rent_free_months?: number | null
          review_amount?: number | null
          review_freq_months?: number | null
          review_type?: Database["public"]["Enums"]["commercial_review_type"]
          security_amount?: number | null
          security_type?: Database["public"]["Enums"]["commercial_security_type"]
          status?: Database["public"]["Enums"]["commercial_lease_status"]
          suite_unit?: string | null
          tenant_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_leases_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "commercial_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_properties: {
        Row: {
          acquisition_date: string | null
          address: string
          asset_class: Database["public"]["Enums"]["commercial_asset_class"]
          asset_sub_type: string | null
          client_id: string | null
          created_at: string
          gfa_sqm: number | null
          gst_treatment: Database["public"]["Enums"]["commercial_gst_treatment"]
          id: string
          industrial_specs: Json
          linked_at: string | null
          nla_sqm: number | null
          notes: string | null
          outgoings_recoverable: Json
          parking_bays: number | null
          postcode: string | null
          purchase_price: number | null
          site_area_sqm: number | null
          state: string | null
          suburb: string | null
          tenure: Database["public"]["Enums"]["commercial_tenure"]
          updated_at: string
          user_id: string
          valuation: number | null
          valuation_date: string | null
          valuer: string | null
          year_built: number | null
          zoning: string | null
        }
        Insert: {
          acquisition_date?: string | null
          address: string
          asset_class?: Database["public"]["Enums"]["commercial_asset_class"]
          asset_sub_type?: string | null
          client_id?: string | null
          created_at?: string
          gfa_sqm?: number | null
          gst_treatment?: Database["public"]["Enums"]["commercial_gst_treatment"]
          id?: string
          industrial_specs?: Json
          linked_at?: string | null
          nla_sqm?: number | null
          notes?: string | null
          outgoings_recoverable?: Json
          parking_bays?: number | null
          postcode?: string | null
          purchase_price?: number | null
          site_area_sqm?: number | null
          state?: string | null
          suburb?: string | null
          tenure?: Database["public"]["Enums"]["commercial_tenure"]
          updated_at?: string
          user_id: string
          valuation?: number | null
          valuation_date?: string | null
          valuer?: string | null
          year_built?: number | null
          zoning?: string | null
        }
        Update: {
          acquisition_date?: string | null
          address?: string
          asset_class?: Database["public"]["Enums"]["commercial_asset_class"]
          asset_sub_type?: string | null
          client_id?: string | null
          created_at?: string
          gfa_sqm?: number | null
          gst_treatment?: Database["public"]["Enums"]["commercial_gst_treatment"]
          id?: string
          industrial_specs?: Json
          linked_at?: string | null
          nla_sqm?: number | null
          notes?: string | null
          outgoings_recoverable?: Json
          parking_bays?: number | null
          postcode?: string | null
          purchase_price?: number | null
          site_area_sqm?: number | null
          state?: string | null
          suburb?: string | null
          tenure?: Database["public"]["Enums"]["commercial_tenure"]
          updated_at?: string
          user_id?: string
          valuation?: number | null
          valuation_date?: string | null
          valuer?: string | null
          year_built?: number | null
          zoning?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commercial_properties_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_ledger: {
        Row: {
          aggregator_fee: number
          broker_amount: number
          broker_id: string | null
          broker_split_pct: number
          client_id: string | null
          commission_rate: number | null
          created_at: string
          created_by: string | null
          deal_id: string | null
          expected_date: string | null
          gross_amount: number
          gst_amount: number
          id: string
          invoiced_date: string | null
          lender_id: string | null
          lender_name: string | null
          loan_amount: number | null
          metadata: Json | null
          net_amount: number
          notes: string | null
          received_date: string | null
          reconciled_date: string | null
          reference: string | null
          status: Database["public"]["Enums"]["commission_status"]
          submission_id: string | null
          type: Database["public"]["Enums"]["commission_type"]
          updated_at: string
        }
        Insert: {
          aggregator_fee?: number
          broker_amount?: number
          broker_id?: string | null
          broker_split_pct?: number
          client_id?: string | null
          commission_rate?: number | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          expected_date?: string | null
          gross_amount?: number
          gst_amount?: number
          id?: string
          invoiced_date?: string | null
          lender_id?: string | null
          lender_name?: string | null
          loan_amount?: number | null
          metadata?: Json | null
          net_amount?: number
          notes?: string | null
          received_date?: string | null
          reconciled_date?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["commission_status"]
          submission_id?: string | null
          type?: Database["public"]["Enums"]["commission_type"]
          updated_at?: string
        }
        Update: {
          aggregator_fee?: number
          broker_amount?: number
          broker_id?: string | null
          broker_split_pct?: number
          client_id?: string | null
          commission_rate?: number | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          expected_date?: string | null
          gross_amount?: number
          gst_amount?: number
          id?: string
          invoiced_date?: string | null
          lender_id?: string | null
          lender_name?: string | null
          loan_amount?: number | null
          metadata?: Json | null
          net_amount?: number
          notes?: string | null
          received_date?: string | null
          reconciled_date?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["commission_status"]
          submission_id?: string | null
          type?: Database["public"]["Enums"]["commission_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_ledger_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_ledger_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "client_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_ledger_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["client_deal_id"]
          },
          {
            foreignKeyName: "commission_ledger_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "lender_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_payout_audit: {
        Row: {
          actor_id: string | null
          amount_gross: number | null
          amount_net: number | null
          approver_id: string | null
          created_at: string
          entry_count: number | null
          event: string
          id: string
          metadata: Json
          payout_id: string
        }
        Insert: {
          actor_id?: string | null
          amount_gross?: number | null
          amount_net?: number | null
          approver_id?: string | null
          created_at?: string
          entry_count?: number | null
          event: string
          id?: string
          metadata?: Json
          payout_id: string
        }
        Update: {
          actor_id?: string | null
          amount_gross?: number | null
          amount_net?: number | null
          approver_id?: string | null
          created_at?: string
          entry_count?: number | null
          event?: string
          id?: string
          metadata?: Json
          payout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_payout_audit_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "commission_payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_payouts: {
        Row: {
          approval_note: string | null
          approved_at: string | null
          approved_by: string | null
          broker_id: string
          broker_name: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          entry_count: number
          generated_by: string | null
          id: string
          idempotency_key: string | null
          ledger_entry_ids: string[] | null
          notes: string | null
          paid_at: string | null
          payment_method: string | null
          payment_reference: string | null
          pdf_hash: string | null
          pdf_storage_path: string | null
          period_end: string
          period_start: string
          status: Database["public"]["Enums"]["payout_status"]
          total_gross: number
          total_gst: number
          total_net: number
          updated_at: string
        }
        Insert: {
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          broker_id: string
          broker_name?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          entry_count?: number
          generated_by?: string | null
          id?: string
          idempotency_key?: string | null
          ledger_entry_ids?: string[] | null
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          pdf_hash?: string | null
          pdf_storage_path?: string | null
          period_end: string
          period_start: string
          status?: Database["public"]["Enums"]["payout_status"]
          total_gross?: number
          total_gst?: number
          total_net?: number
          updated_at?: string
        }
        Update: {
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          broker_id?: string
          broker_name?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          entry_count?: number
          generated_by?: string | null
          id?: string
          idempotency_key?: string | null
          ledger_entry_ids?: string[] | null
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          pdf_hash?: string | null
          pdf_storage_path?: string | null
          period_end?: string
          period_start?: string
          status?: Database["public"]["Enums"]["payout_status"]
          total_gross?: number
          total_gst?: number
          total_net?: number
          updated_at?: string
        }
        Relationships: []
      }
      comparison_analysis_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          settings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          settings: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comparison_analysis_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_pack_exports: {
        Row: {
          client_id: string
          created_at: string
          deal_id: string | null
          generated_at: string
          generated_by: string | null
          id: string
          included_record_ids: string[]
          included_types: Database["public"]["Enums"]["compliance_record_type"][]
          notes: string | null
          page_count: number | null
          pdf_storage_path: string | null
          shared_with_client: boolean
        }
        Insert: {
          client_id: string
          created_at?: string
          deal_id?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          included_record_ids?: string[]
          included_types?: Database["public"]["Enums"]["compliance_record_type"][]
          notes?: string | null
          page_count?: number | null
          pdf_storage_path?: string | null
          shared_with_client?: boolean
        }
        Update: {
          client_id?: string
          created_at?: string
          deal_id?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          included_record_ids?: string[]
          included_types?: Database["public"]["Enums"]["compliance_record_type"][]
          notes?: string | null
          page_count?: number | null
          pdf_storage_path?: string | null
          shared_with_client?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "compliance_pack_exports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_pack_exports_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "client_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_pack_exports_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["client_deal_id"]
          },
        ]
      }
      compliance_records: {
        Row: {
          client_id: string
          content: Json
          created_at: string
          deal_id: string | null
          docusign_envelope_id: string | null
          docusign_status: string | null
          expires_at: string | null
          generated_at: string
          generated_by: string | null
          id: string
          is_current: boolean
          notes: string | null
          pdf_storage_path: string | null
          signature_method:
            | Database["public"]["Enums"]["signature_method"]
            | null
          signed_at: string | null
          signed_by_name: string | null
          signed_pdf_storage_path: string | null
          status: Database["public"]["Enums"]["compliance_status"]
          superseded_by: string | null
          title: string
          type: Database["public"]["Enums"]["compliance_record_type"]
          updated_at: string
          version: number
        }
        Insert: {
          client_id: string
          content?: Json
          created_at?: string
          deal_id?: string | null
          docusign_envelope_id?: string | null
          docusign_status?: string | null
          expires_at?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          is_current?: boolean
          notes?: string | null
          pdf_storage_path?: string | null
          signature_method?:
            | Database["public"]["Enums"]["signature_method"]
            | null
          signed_at?: string | null
          signed_by_name?: string | null
          signed_pdf_storage_path?: string | null
          status?: Database["public"]["Enums"]["compliance_status"]
          superseded_by?: string | null
          title: string
          type: Database["public"]["Enums"]["compliance_record_type"]
          updated_at?: string
          version?: number
        }
        Update: {
          client_id?: string
          content?: Json
          created_at?: string
          deal_id?: string | null
          docusign_envelope_id?: string | null
          docusign_status?: string | null
          expires_at?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          is_current?: boolean
          notes?: string | null
          pdf_storage_path?: string | null
          signature_method?:
            | Database["public"]["Enums"]["signature_method"]
            | null
          signed_at?: string | null
          signed_by_name?: string | null
          signed_pdf_storage_path?: string | null
          status?: Database["public"]["Enums"]["compliance_status"]
          superseded_by?: string | null
          title?: string
          type?: Database["public"]["Enums"]["compliance_record_type"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "compliance_records_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_records_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "client_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_records_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["client_deal_id"]
          },
        ]
      }
      cover_page_overlays: {
        Row: {
          background_image_url: string | null
          canvas_height: number
          canvas_width: number
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          overlay_elements: Json
          report_type: string
          updated_at: string
        }
        Insert: {
          background_image_url?: string | null
          canvas_height?: number
          canvas_width?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          overlay_elements?: Json
          report_type: string
          updated_at?: string
        }
        Update: {
          background_image_url?: string | null
          canvas_height?: number
          canvas_width?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          overlay_elements?: Json
          report_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cover_page_overlays_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      crime_statistics_cache: {
        Row: {
          created_at: string
          data: Json
          data_quality: string
          expires_at: string
          fetched_at: string
          id: string
          postcode: string
          state: string
          suburb: string
        }
        Insert: {
          created_at?: string
          data: Json
          data_quality?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          postcode: string
          state: string
          suburb: string
        }
        Update: {
          created_at?: string
          data?: Json
          data_quality?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          postcode?: string
          state?: string
          suburb?: string
        }
        Relationships: []
      }
      cron_vault_bootstrap_marker: {
        Row: {
          bootstrapped_at: string
          id: string
        }
        Insert: {
          bootstrapped_at?: string
          id?: string
        }
        Update: {
          bootstrapped_at?: string
          id?: string
        }
        Relationships: []
      }
      custom_users: {
        Row: {
          created_at: string
          deleted_at: string | null
          email: string
          email_signature: string | null
          failed_login_attempts: number
          id: string
          is_active: boolean
          last_login_at: string | null
          locked_until: string | null
          mfa_enrolled_at: string | null
          mfa_last_verified_at: string | null
          mfa_method: string | null
          mfa_recovery_codes_hash: string[] | null
          mfa_required: boolean
          mfa_secret_encrypted: string | null
          microsoft_email: string | null
          outlook_auto_prep_enabled: boolean | null
          outlook_follow_up_blocking: boolean | null
          outlook_follow_up_default_duration: number | null
          outlook_prep_minutes: number | null
          password_hash: string
          personal_mailbox: string | null
          role: string
          timezone: string
          updated_at: string
          username: string
          webauthn_enrolled_at: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          email: string
          email_signature?: string | null
          failed_login_attempts?: number
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          locked_until?: string | null
          mfa_enrolled_at?: string | null
          mfa_last_verified_at?: string | null
          mfa_method?: string | null
          mfa_recovery_codes_hash?: string[] | null
          mfa_required?: boolean
          mfa_secret_encrypted?: string | null
          microsoft_email?: string | null
          outlook_auto_prep_enabled?: boolean | null
          outlook_follow_up_blocking?: boolean | null
          outlook_follow_up_default_duration?: number | null
          outlook_prep_minutes?: number | null
          password_hash: string
          personal_mailbox?: string | null
          role?: string
          timezone?: string
          updated_at?: string
          username: string
          webauthn_enrolled_at?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          email?: string
          email_signature?: string | null
          failed_login_attempts?: number
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          locked_until?: string | null
          mfa_enrolled_at?: string | null
          mfa_last_verified_at?: string | null
          mfa_method?: string | null
          mfa_recovery_codes_hash?: string[] | null
          mfa_required?: boolean
          mfa_secret_encrypted?: string | null
          microsoft_email?: string | null
          outlook_auto_prep_enabled?: boolean | null
          outlook_follow_up_blocking?: boolean | null
          outlook_follow_up_default_duration?: number | null
          outlook_prep_minutes?: number | null
          password_hash?: string
          personal_mailbox?: string | null
          role?: string
          timezone?: string
          updated_at?: string
          username?: string
          webauthn_enrolled_at?: string | null
        }
        Relationships: []
      }
      dashboard_modules: {
        Row: {
          category: string
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_active: boolean
          module_key: string
          module_name: string
          route: string | null
          sort_order: number
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          module_key: string
          module_name: string
          route?: string | null
          sort_order?: number
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          module_key?: string
          module_name?: string
          route?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      data_provenance: {
        Row: {
          branch: number
          cache_ttl_days: number
          confidence: number
          created_at: string
          fetched_at: string
          field_key: string
          id: string
          licence_tag: string
          property_address: string | null
          report_id: string | null
          request_id: string | null
          source: string
          value_numeric: number | null
          value_text: string | null
        }
        Insert: {
          branch: number
          cache_ttl_days?: number
          confidence: number
          created_at?: string
          fetched_at?: string
          field_key: string
          id?: string
          licence_tag?: string
          property_address?: string | null
          report_id?: string | null
          request_id?: string | null
          source: string
          value_numeric?: number | null
          value_text?: string | null
        }
        Update: {
          branch?: number
          cache_ttl_days?: number
          confidence?: number
          created_at?: string
          fetched_at?: string
          field_key?: string
          id?: string
          licence_tag?: string
          property_address?: string | null
          report_id?: string | null
          request_id?: string | null
          source?: string
          value_numeric?: number | null
          value_text?: string | null
        }
        Relationships: []
      }
      deal_stages: {
        Row: {
          client_action: string | null
          completed_at: string | null
          created_at: string
          deal_id: string
          display_order: number
          id: string
          internal_action: string | null
          invoice_received: boolean | null
          invoice_received_date: string | null
          key_date: string | null
          notes: string | null
          percentage_or_amount: string | null
          responsible: string | null
          stage_category: string | null
          stage_name: string
          stage_number: number
          status: Database["public"]["Enums"]["deal_stage_status"]
        }
        Insert: {
          client_action?: string | null
          completed_at?: string | null
          created_at?: string
          deal_id: string
          display_order?: number
          id?: string
          internal_action?: string | null
          invoice_received?: boolean | null
          invoice_received_date?: string | null
          key_date?: string | null
          notes?: string | null
          percentage_or_amount?: string | null
          responsible?: string | null
          stage_category?: string | null
          stage_name: string
          stage_number: number
          status?: Database["public"]["Enums"]["deal_stage_status"]
        }
        Update: {
          client_action?: string | null
          completed_at?: string | null
          created_at?: string
          deal_id?: string
          display_order?: number
          id?: string
          internal_action?: string | null
          invoice_received?: boolean | null
          invoice_received_date?: string | null
          key_date?: string | null
          notes?: string | null
          percentage_or_amount?: string | null
          responsible?: string | null
          stage_category?: string | null
          stage_name?: string
          stage_number?: number
          status?: Database["public"]["Enums"]["deal_stage_status"]
        }
        Relationships: [
          {
            foreignKeyName: "deal_stages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "client_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_stages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["client_deal_id"]
          },
        ]
      }
      depreciation_comps: {
        Row: {
          build_year: number
          created_at: string
          created_by: string | null
          dv_year1: number
          dv_year10: number
          dv_year2: number
          dv_year3: number
          dv_year4: number
          dv_year5: number
          dv_year6: number
          dv_year7: number
          dv_year8: number
          dv_year9: number
          finish_standard: Database["public"]["Enums"]["depreciation_finish_standard"]
          fully_furnished: boolean
          id: string
          nearest_city: Database["public"]["Enums"]["depreciation_nearest_city"]
          notes: string | null
          pc_year1: number
          pc_year10: number
          pc_year2: number
          pc_year3: number
          pc_year4: number
          pc_year5: number
          pc_year6: number
          pc_year7: number
          pc_year8: number
          pc_year9: number
          property_type: Database["public"]["Enums"]["depreciation_property_type"]
          purchase_date_category: Database["public"]["Enums"]["depreciation_purchase_date_category"]
          purchase_price: number
          renovated: boolean
          source_schedule_id: string | null
          updated_at: string
        }
        Insert: {
          build_year: number
          created_at?: string
          created_by?: string | null
          dv_year1?: number
          dv_year10?: number
          dv_year2?: number
          dv_year3?: number
          dv_year4?: number
          dv_year5?: number
          dv_year6?: number
          dv_year7?: number
          dv_year8?: number
          dv_year9?: number
          finish_standard: Database["public"]["Enums"]["depreciation_finish_standard"]
          fully_furnished?: boolean
          id?: string
          nearest_city: Database["public"]["Enums"]["depreciation_nearest_city"]
          notes?: string | null
          pc_year1?: number
          pc_year10?: number
          pc_year2?: number
          pc_year3?: number
          pc_year4?: number
          pc_year5?: number
          pc_year6?: number
          pc_year7?: number
          pc_year8?: number
          pc_year9?: number
          property_type: Database["public"]["Enums"]["depreciation_property_type"]
          purchase_date_category: Database["public"]["Enums"]["depreciation_purchase_date_category"]
          purchase_price: number
          renovated?: boolean
          source_schedule_id?: string | null
          updated_at?: string
        }
        Update: {
          build_year?: number
          created_at?: string
          created_by?: string | null
          dv_year1?: number
          dv_year10?: number
          dv_year2?: number
          dv_year3?: number
          dv_year4?: number
          dv_year5?: number
          dv_year6?: number
          dv_year7?: number
          dv_year8?: number
          dv_year9?: number
          finish_standard?: Database["public"]["Enums"]["depreciation_finish_standard"]
          fully_furnished?: boolean
          id?: string
          nearest_city?: Database["public"]["Enums"]["depreciation_nearest_city"]
          notes?: string | null
          pc_year1?: number
          pc_year10?: number
          pc_year2?: number
          pc_year3?: number
          pc_year4?: number
          pc_year5?: number
          pc_year6?: number
          pc_year7?: number
          pc_year8?: number
          pc_year9?: number
          property_type?: Database["public"]["Enums"]["depreciation_property_type"]
          purchase_date_category?: Database["public"]["Enums"]["depreciation_purchase_date_category"]
          purchase_price?: number
          renovated?: boolean
          source_schedule_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "depreciation_comps_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      depreciation_estimator_runs: {
        Row: {
          build_year: number
          confidence_score: number | null
          created_at: string
          dv_total: number | null
          dv_year1: number | null
          dv_year10: number | null
          dv_year2: number | null
          dv_year3: number | null
          dv_year4: number | null
          dv_year5: number | null
          dv_year6: number | null
          dv_year7: number | null
          dv_year8: number | null
          dv_year9: number | null
          finish_standard: Database["public"]["Enums"]["depreciation_finish_standard"]
          fully_furnished: boolean
          id: string
          match_count: number
          nearest_city: Database["public"]["Enums"]["depreciation_nearest_city"]
          pc_total: number | null
          pc_year1: number | null
          pc_year10: number | null
          pc_year2: number | null
          pc_year3: number | null
          pc_year4: number | null
          pc_year5: number | null
          pc_year6: number | null
          pc_year7: number | null
          pc_year8: number | null
          pc_year9: number | null
          property_type: Database["public"]["Enums"]["depreciation_property_type"]
          purchase_date: string | null
          purchase_date_category: Database["public"]["Enums"]["depreciation_purchase_date_category"]
          purchase_price: number
          renovated: boolean
          top_comp_ids: string[] | null
          user_id: string | null
        }
        Insert: {
          build_year: number
          confidence_score?: number | null
          created_at?: string
          dv_total?: number | null
          dv_year1?: number | null
          dv_year10?: number | null
          dv_year2?: number | null
          dv_year3?: number | null
          dv_year4?: number | null
          dv_year5?: number | null
          dv_year6?: number | null
          dv_year7?: number | null
          dv_year8?: number | null
          dv_year9?: number | null
          finish_standard: Database["public"]["Enums"]["depreciation_finish_standard"]
          fully_furnished?: boolean
          id?: string
          match_count?: number
          nearest_city: Database["public"]["Enums"]["depreciation_nearest_city"]
          pc_total?: number | null
          pc_year1?: number | null
          pc_year10?: number | null
          pc_year2?: number | null
          pc_year3?: number | null
          pc_year4?: number | null
          pc_year5?: number | null
          pc_year6?: number | null
          pc_year7?: number | null
          pc_year8?: number | null
          pc_year9?: number | null
          property_type: Database["public"]["Enums"]["depreciation_property_type"]
          purchase_date?: string | null
          purchase_date_category: Database["public"]["Enums"]["depreciation_purchase_date_category"]
          purchase_price: number
          renovated?: boolean
          top_comp_ids?: string[] | null
          user_id?: string | null
        }
        Update: {
          build_year?: number
          confidence_score?: number | null
          created_at?: string
          dv_total?: number | null
          dv_year1?: number | null
          dv_year10?: number | null
          dv_year2?: number | null
          dv_year3?: number | null
          dv_year4?: number | null
          dv_year5?: number | null
          dv_year6?: number | null
          dv_year7?: number | null
          dv_year8?: number | null
          dv_year9?: number | null
          finish_standard?: Database["public"]["Enums"]["depreciation_finish_standard"]
          fully_furnished?: boolean
          id?: string
          match_count?: number
          nearest_city?: Database["public"]["Enums"]["depreciation_nearest_city"]
          pc_total?: number | null
          pc_year1?: number | null
          pc_year10?: number | null
          pc_year2?: number | null
          pc_year3?: number | null
          pc_year4?: number | null
          pc_year5?: number | null
          pc_year6?: number | null
          pc_year7?: number | null
          pc_year8?: number | null
          pc_year9?: number | null
          property_type?: Database["public"]["Enums"]["depreciation_property_type"]
          purchase_date?: string | null
          purchase_date_category?: Database["public"]["Enums"]["depreciation_purchase_date_category"]
          purchase_price?: number
          renovated?: boolean
          top_comp_ids?: string[] | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "depreciation_estimator_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      design_tokens: {
        Row: {
          brand_kit_id: string | null
          colors: Json
          created_at: string
          created_by: string | null
          fonts: Json
          gradients: Json
          id: string
          is_default: boolean
          name: string
          radii: Json
          scope: string
          shadows: Json
          spacing_scale: Json
          template_id: string | null
          theme: string
          type_scale: Json
          updated_at: string
        }
        Insert: {
          brand_kit_id?: string | null
          colors?: Json
          created_at?: string
          created_by?: string | null
          fonts?: Json
          gradients?: Json
          id?: string
          is_default?: boolean
          name: string
          radii?: Json
          scope: string
          shadows?: Json
          spacing_scale?: Json
          template_id?: string | null
          theme?: string
          type_scale?: Json
          updated_at?: string
        }
        Update: {
          brand_kit_id?: string | null
          colors?: Json
          created_at?: string
          created_by?: string | null
          fonts?: Json
          gradients?: Json
          id?: string
          is_default?: boolean
          name?: string
          radii?: Json
          scope?: string
          shadows?: Json
          spacing_scale?: Json
          template_id?: string | null
          theme?: string
          type_scale?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "design_tokens_brand_kit_id_fkey"
            columns: ["brand_kit_id"]
            isOneToOne: false
            referencedRelation: "brand_kits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_tokens_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          chunk_index: number
          chunk_text: string
          content_hash: string | null
          conversation_id: string | null
          created_at: string
          document_name: string
          embedding: string | null
          id: string
          metadata: Json | null
          model_version: string | null
          page_number: number | null
          paragraph_index: number | null
          postcode: string | null
          report_type: string | null
          state: string | null
          suburb: string | null
          tsv: unknown
        }
        Insert: {
          chunk_index: number
          chunk_text: string
          content_hash?: string | null
          conversation_id?: string | null
          created_at?: string
          document_name: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          model_version?: string | null
          page_number?: number | null
          paragraph_index?: number | null
          postcode?: string | null
          report_type?: string | null
          state?: string | null
          suburb?: string | null
          tsv?: unknown
        }
        Update: {
          chunk_index?: number
          chunk_text?: string
          content_hash?: string | null
          conversation_id?: string | null
          created_at?: string
          document_name?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          model_version?: string | null
          page_number?: number | null
          paragraph_index?: number | null
          postcode?: string | null
          report_type?: string | null
          state?: string | null
          suburb?: string | null
          tsv?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "report_qa_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_requirement_instances: {
        Row: {
          applicant_id: string | null
          auto_reminder_enabled: boolean
          category: Database["public"]["Enums"]["document_requirement_category"]
          client_id: string
          created_at: string
          created_by_finance_user_id: string | null
          created_by_team_user_id: string | null
          description: string | null
          detected_doc_date: string | null
          detected_doc_type: string | null
          document_id: string | null
          due_date: string | null
          escalation_level: string
          expiry_date: string | null
          id: string
          is_required: boolean
          label: string
          last_reminder_sent_at: string | null
          notes: string | null
          owner: Database["public"]["Enums"]["document_requirement_owner"]
          purchase_file_id: string
          quality_checked_at: string | null
          quality_flags: Json
          quality_status: string
          reminder_count: number
          request_message: string | null
          requested_at: string | null
          requested_by_finance_user_id: string | null
          soft_expiry_date: string | null
          sort_order: number
          status: Database["public"]["Enums"]["document_requirement_status"]
          template_id: string | null
          updated_at: string
          uploaded_at: string | null
          verified_at: string | null
          verified_by_finance_user_id: string | null
          visible_to_client: boolean
          visible_to_finance: boolean
          visible_to_legal: boolean
          visible_to_npc: boolean
        }
        Insert: {
          applicant_id?: string | null
          auto_reminder_enabled?: boolean
          category: Database["public"]["Enums"]["document_requirement_category"]
          client_id: string
          created_at?: string
          created_by_finance_user_id?: string | null
          created_by_team_user_id?: string | null
          description?: string | null
          detected_doc_date?: string | null
          detected_doc_type?: string | null
          document_id?: string | null
          due_date?: string | null
          escalation_level?: string
          expiry_date?: string | null
          id?: string
          is_required?: boolean
          label: string
          last_reminder_sent_at?: string | null
          notes?: string | null
          owner?: Database["public"]["Enums"]["document_requirement_owner"]
          purchase_file_id: string
          quality_checked_at?: string | null
          quality_flags?: Json
          quality_status?: string
          reminder_count?: number
          request_message?: string | null
          requested_at?: string | null
          requested_by_finance_user_id?: string | null
          soft_expiry_date?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["document_requirement_status"]
          template_id?: string | null
          updated_at?: string
          uploaded_at?: string | null
          verified_at?: string | null
          verified_by_finance_user_id?: string | null
          visible_to_client?: boolean
          visible_to_finance?: boolean
          visible_to_legal?: boolean
          visible_to_npc?: boolean
        }
        Update: {
          applicant_id?: string | null
          auto_reminder_enabled?: boolean
          category?: Database["public"]["Enums"]["document_requirement_category"]
          client_id?: string
          created_at?: string
          created_by_finance_user_id?: string | null
          created_by_team_user_id?: string | null
          description?: string | null
          detected_doc_date?: string | null
          detected_doc_type?: string | null
          document_id?: string | null
          due_date?: string | null
          escalation_level?: string
          expiry_date?: string | null
          id?: string
          is_required?: boolean
          label?: string
          last_reminder_sent_at?: string | null
          notes?: string | null
          owner?: Database["public"]["Enums"]["document_requirement_owner"]
          purchase_file_id?: string
          quality_checked_at?: string | null
          quality_flags?: Json
          quality_status?: string
          reminder_count?: number
          request_message?: string | null
          requested_at?: string | null
          requested_by_finance_user_id?: string | null
          soft_expiry_date?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["document_requirement_status"]
          template_id?: string | null
          updated_at?: string
          uploaded_at?: string | null
          verified_at?: string | null
          verified_by_finance_user_id?: string | null
          visible_to_client?: boolean
          visible_to_finance?: boolean
          visible_to_legal?: boolean
          visible_to_npc?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "document_requirement_instance_requested_by_finance_user_id_fkey"
            columns: ["requested_by_finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requirement_instances_applicant_id_fkey"
            columns: ["applicant_id"]
            isOneToOne: false
            referencedRelation: "purchase_file_applicants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requirement_instances_created_by_finance_user_id_fkey"
            columns: ["created_by_finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requirement_instances_created_by_team_user_id_fkey"
            columns: ["created_by_team_user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requirement_instances_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requirement_instances_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requirement_instances_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
          {
            foreignKeyName: "document_requirement_instances_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_requirement_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requirement_instances_verified_by_finance_user_id_fkey"
            columns: ["verified_by_finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      document_requirement_templates: {
        Row: {
          category: Database["public"]["Enums"]["document_requirement_category"]
          created_at: string
          default_owner: Database["public"]["Enums"]["document_requirement_owner"]
          description: string | null
          id: string
          is_active: boolean
          is_required: boolean
          label: string
          purchase_type: Database["public"]["Enums"]["purchase_file_type"]
          sort_order: number
          updated_at: string
        }
        Insert: {
          category: Database["public"]["Enums"]["document_requirement_category"]
          created_at?: string
          default_owner?: Database["public"]["Enums"]["document_requirement_owner"]
          description?: string | null
          id?: string
          is_active?: boolean
          is_required?: boolean
          label: string
          purchase_type: Database["public"]["Enums"]["purchase_file_type"]
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["document_requirement_category"]
          created_at?: string
          default_owner?: Database["public"]["Enums"]["document_requirement_owner"]
          description?: string | null
          id?: string
          is_active?: boolean
          is_required?: boolean
          label?: string
          purchase_type?: Database["public"]["Enums"]["purchase_file_type"]
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      document_signature_events: {
        Row: {
          compliance_record_id: string | null
          created_at: string
          document_id: string | null
          docusign_envelope_id: string | null
          event_status: string | null
          event_type: string
          id: string
          occurred_at: string
          payload: Json | null
          recipient_email: string | null
          recipient_name: string | null
        }
        Insert: {
          compliance_record_id?: string | null
          created_at?: string
          document_id?: string | null
          docusign_envelope_id?: string | null
          event_status?: string | null
          event_type: string
          id?: string
          occurred_at?: string
          payload?: Json | null
          recipient_email?: string | null
          recipient_name?: string | null
        }
        Update: {
          compliance_record_id?: string | null
          created_at?: string
          document_id?: string | null
          docusign_envelope_id?: string | null
          event_status?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          payload?: Json | null
          recipient_email?: string | null
          recipient_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_signature_events_compliance_record_id_fkey"
            columns: ["compliance_record_id"]
            isOneToOne: false
            referencedRelation: "compliance_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_signature_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "generated_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      economic_data_cache: {
        Row: {
          created_at: string
          data: Json
          data_type: string
          expires_at: string
          fetched_at: string
          id: string
        }
        Insert: {
          created_at?: string
          data: Json
          data_type: string
          expires_at?: string
          fetched_at?: string
          id?: string
        }
        Update: {
          created_at?: string
          data?: Json
          data_type?: string
          expires_at?: string
          fetched_at?: string
          id?: string
        }
        Relationships: []
      }
      email_copilot_email_addresses: {
        Row: {
          address: string
          address_kind: string
          created_at: string
          email_id: string
        }
        Insert: {
          address: string
          address_kind?: string
          created_at?: string
          email_id: string
        }
        Update: {
          address?: string
          address_kind?: string
          created_at?: string
          email_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_copilot_email_addresses_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "email_copilot_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      email_copilot_emails: {
        Row: {
          attachments: Json | null
          bcc_recipients: string[] | null
          body: string
          body_html: string | null
          body_preview: string | null
          cc_recipients: string[] | null
          client_id: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          draft_reply: string | null
          folder: string
          id: string
          linked_property_address: string | null
          linked_report_id: string | null
          mailbox_source: string | null
          owner_user_id: string | null
          received_at: string | null
          sender: string
          status: string
          subject: string
          summary: Json | null
          to_recipients: string[] | null
          updated_at: string
          urgency_level: string | null
        }
        Insert: {
          attachments?: Json | null
          bcc_recipients?: string[] | null
          body: string
          body_html?: string | null
          body_preview?: string | null
          cc_recipients?: string[] | null
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          draft_reply?: string | null
          folder?: string
          id?: string
          linked_property_address?: string | null
          linked_report_id?: string | null
          mailbox_source?: string | null
          owner_user_id?: string | null
          received_at?: string | null
          sender: string
          status?: string
          subject: string
          summary?: Json | null
          to_recipients?: string[] | null
          updated_at?: string
          urgency_level?: string | null
        }
        Update: {
          attachments?: Json | null
          bcc_recipients?: string[] | null
          body?: string
          body_html?: string | null
          body_preview?: string | null
          cc_recipients?: string[] | null
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          draft_reply?: string | null
          folder?: string
          id?: string
          linked_property_address?: string | null
          linked_report_id?: string | null
          mailbox_source?: string | null
          owner_user_id?: string | null
          received_at?: string | null
          sender?: string
          status?: string
          subject?: string
          summary?: Json | null
          to_recipients?: string[] | null
          updated_at?: string
          urgency_level?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_copilot_emails_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_copilot_emails_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_copilot_emails_linked_report_id_fkey"
            columns: ["linked_report_id"]
            isOneToOne: false
            referencedRelation: "investment_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      email_copilot_scheduled_sends: {
        Row: {
          attachments: Json | null
          bcc_recipients: string[] | null
          body: string
          cc_recipients: string[] | null
          created_at: string
          error: string | null
          id: string
          mailbox_source: string
          original_email_id: string | null
          recipient: string
          scheduled_for: string
          sent_at: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attachments?: Json | null
          bcc_recipients?: string[] | null
          body?: string
          cc_recipients?: string[] | null
          created_at?: string
          error?: string | null
          id?: string
          mailbox_source?: string
          original_email_id?: string | null
          recipient: string
          scheduled_for: string
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attachments?: Json | null
          bcc_recipients?: string[] | null
          body?: string
          cc_recipients?: string[] | null
          created_at?: string
          error?: string | null
          id?: string
          mailbox_source?: string
          original_email_id?: string | null
          recipient?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_copilot_sent_replies: {
        Row: {
          attachments: Json | null
          bcc_recipients: string[] | null
          body: string
          cc_recipients: string[] | null
          created_by: string | null
          id: string
          mailbox_source: string | null
          original_email_id: string | null
          owner_user_id: string | null
          recipient: string
          sent_at: string
          subject: string
        }
        Insert: {
          attachments?: Json | null
          bcc_recipients?: string[] | null
          body: string
          cc_recipients?: string[] | null
          created_by?: string | null
          id?: string
          mailbox_source?: string | null
          original_email_id?: string | null
          owner_user_id?: string | null
          recipient: string
          sent_at?: string
          subject: string
        }
        Update: {
          attachments?: Json | null
          bcc_recipients?: string[] | null
          body?: string
          cc_recipients?: string[] | null
          created_by?: string | null
          id?: string
          mailbox_source?: string | null
          original_email_id?: string | null
          owner_user_id?: string | null
          recipient?: string
          sent_at?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_copilot_sent_replies_original_email_id_fkey"
            columns: ["original_email_id"]
            isOneToOne: false
            referencedRelation: "email_copilot_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      email_copilot_snippets: {
        Row: {
          body: string
          category: string | null
          created_at: string
          id: string
          shortcut: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          category?: string | null
          created_at?: string
          id?: string
          shortcut?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string | null
          created_at?: string
          id?: string
          shortcut?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_linking_excluded_addresses: {
        Row: {
          address: string
          created_at: string
          reason: string | null
        }
        Insert: {
          address: string
          created_at?: string
          reason?: string | null
        }
        Update: {
          address?: string
          created_at?: string
          reason?: string | null
        }
        Relationships: []
      }
      export_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          error_summary: string | null
          export_type: string
          file_format: string
          file_size_bytes: number | null
          id: string
          processed_items: number
          scope: Json
          signed_url: string | null
          signed_url_expires_at: string | null
          started_at: string | null
          status: string
          storage_bucket: string | null
          storage_path: string | null
          total_items: number
          total_messages: number
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_summary?: string | null
          export_type: string
          file_format: string
          file_size_bytes?: number | null
          id?: string
          processed_items?: number
          scope?: Json
          signed_url?: string | null
          signed_url_expires_at?: string | null
          started_at?: string | null
          status?: string
          storage_bucket?: string | null
          storage_path?: string | null
          total_items?: number
          total_messages?: number
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_summary?: string | null
          export_type?: string
          file_format?: string
          file_size_bytes?: number | null
          id?: string
          processed_items?: number
          scope?: Json
          signed_url?: string | null
          signed_url_expires_at?: string | null
          started_at?: string | null
          status?: string
          storage_bucket?: string | null
          storage_path?: string | null
          total_items?: number
          total_messages?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          created_at?: string
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      figma_template_sync_log: {
        Row: {
          created_at: string
          diff: Json | null
          duration_ms: number | null
          error: string | null
          figma_template_id: string | null
          id: string
          operation: string
          status: string
          summary: string | null
          triggered_by: string | null
        }
        Insert: {
          created_at?: string
          diff?: Json | null
          duration_ms?: number | null
          error?: string | null
          figma_template_id?: string | null
          id?: string
          operation: string
          status: string
          summary?: string | null
          triggered_by?: string | null
        }
        Update: {
          created_at?: string
          diff?: Json | null
          duration_ms?: number | null
          error?: string | null
          figma_template_id?: string | null
          id?: string
          operation?: string
          status?: string
          summary?: string | null
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "figma_template_sync_log_figma_template_id_fkey"
            columns: ["figma_template_id"]
            isOneToOne: false
            referencedRelation: "figma_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      figma_templates: {
        Row: {
          compile_warnings: Json | null
          compiled_schema: Json | null
          created_at: string
          created_by: string | null
          description: string | null
          figma_file_key: string
          figma_node_id: string | null
          figma_url: string | null
          id: string
          is_active: boolean
          is_default: boolean
          label: string
          last_sync_error: string | null
          last_sync_status: string | null
          last_synced_at: string | null
          metadata: Json
          raw_node: Json | null
          report_type: string
          thumbnail_expires_at: string | null
          thumbnail_url: string | null
          tier: string | null
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          compile_warnings?: Json | null
          compiled_schema?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          figma_file_key: string
          figma_node_id?: string | null
          figma_url?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          label: string
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          metadata?: Json
          raw_node?: Json | null
          report_type?: string
          thumbnail_expires_at?: string | null
          thumbnail_url?: string | null
          tier?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          compile_warnings?: Json | null
          compiled_schema?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          figma_file_key?: string
          figma_node_id?: string | null
          figma_url?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          label?: string
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          metadata?: Json
          raw_node?: Json | null
          report_type?: string
          thumbnail_expires_at?: string | null
          thumbnail_url?: string | null
          tier?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: []
      }
      finance_agent_contacts: {
        Row: {
          abn: string | null
          bank_account_name: string | null
          bank_account_number: string | null
          bank_bsb: string | null
          company: string | null
          contact_type: string | null
          created_at: string
          created_by: string | null
          default_commission_basis: string | null
          default_commission_rate_pct: number | null
          email: string
          gst_registered: boolean | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          name: string
          notes: string | null
          payment_method: string | null
          updated_at: string
        }
        Insert: {
          abn?: string | null
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_bsb?: string | null
          company?: string | null
          contact_type?: string | null
          created_at?: string
          created_by?: string | null
          default_commission_basis?: string | null
          default_commission_rate_pct?: number | null
          email: string
          gst_registered?: boolean | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name: string
          notes?: string | null
          payment_method?: string | null
          updated_at?: string
        }
        Update: {
          abn?: string | null
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_bsb?: string | null
          company?: string | null
          contact_type?: string | null
          created_at?: string
          created_by?: string | null
          default_commission_basis?: string | null
          default_commission_rate_pct?: number | null
          email?: string
          gst_registered?: boolean | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          notes?: string | null
          payment_method?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_agent_contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_email_opens: {
        Row: {
          client_id: string | null
          created_at: string
          finance_contact_id: string | null
          ghl_message_id: string | null
          id: string
          last_ip: string | null
          last_user_agent: string | null
          open_count: number
          opened_at: string | null
          outlook_message_id: string | null
          purchase_file_id: string | null
          recipient_email: string | null
          subject: string | null
          tracking_token: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          finance_contact_id?: string | null
          ghl_message_id?: string | null
          id?: string
          last_ip?: string | null
          last_user_agent?: string | null
          open_count?: number
          opened_at?: string | null
          outlook_message_id?: string | null
          purchase_file_id?: string | null
          recipient_email?: string | null
          subject?: string | null
          tracking_token: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          finance_contact_id?: string | null
          ghl_message_id?: string | null
          id?: string
          last_ip?: string | null
          last_user_agent?: string | null
          open_count?: number
          opened_at?: string | null
          outlook_message_id?: string | null
          purchase_file_id?: string | null
          recipient_email?: string | null
          subject?: string | null
          tracking_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_email_opens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_email_opens_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_email_opens_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      finance_message_translations: {
        Row: {
          created_at: string
          id: string
          model: string | null
          requested_by_finance_contact_id: string | null
          source_id: string
          source_kind: string
          source_lang: string | null
          target_lang: string
          translated_text: string
        }
        Insert: {
          created_at?: string
          id?: string
          model?: string | null
          requested_by_finance_contact_id?: string | null
          source_id: string
          source_kind: string
          source_lang?: string | null
          target_lang: string
          translated_text: string
        }
        Update: {
          created_at?: string
          id?: string
          model?: string | null
          requested_by_finance_contact_id?: string | null
          source_id?: string
          source_kind?: string
          source_lang?: string | null
          target_lang?: string
          translated_text?: string
        }
        Relationships: []
      }
      finance_outbound_messages: {
        Row: {
          body: string
          channel: string
          client_id: string
          created_at: string
          delivered_at: string | null
          error_message: string | null
          finance_contact_id: string | null
          ghl_conversation_id: string | null
          id: string
          metadata: Json
          provider: string | null
          provider_message_id: string | null
          purchase_file_id: string | null
          read_at: string | null
          recipient: string | null
          status: string
          subject: string | null
          template_id: string | null
          tracking_token: string | null
          updated_at: string
        }
        Insert: {
          body: string
          channel: string
          client_id: string
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          finance_contact_id?: string | null
          ghl_conversation_id?: string | null
          id?: string
          metadata?: Json
          provider?: string | null
          provider_message_id?: string | null
          purchase_file_id?: string | null
          read_at?: string | null
          recipient?: string | null
          status?: string
          subject?: string | null
          template_id?: string | null
          tracking_token?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          channel?: string
          client_id?: string
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          finance_contact_id?: string | null
          ghl_conversation_id?: string | null
          id?: string
          metadata?: Json
          provider?: string | null
          provider_message_id?: string | null
          purchase_file_id?: string | null
          read_at?: string | null
          recipient?: string | null
          status?: string
          subject?: string | null
          template_id?: string | null
          tracking_token?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_outbound_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_outbound_messages_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_outbound_messages_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
          {
            foreignKeyName: "finance_outbound_messages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "finance_partner_message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_partner_availability: {
        Row: {
          created_at: string
          end_time: string
          finance_user_id: string
          id: string
          is_active: boolean
          slot_duration_min: number
          start_time: string
          timezone: string
          updated_at: string
          weekday: number
        }
        Insert: {
          created_at?: string
          end_time: string
          finance_user_id: string
          id?: string
          is_active?: boolean
          slot_duration_min?: number
          start_time: string
          timezone?: string
          updated_at?: string
          weekday: number
        }
        Update: {
          created_at?: string
          end_time?: string
          finance_user_id?: string
          id?: string
          is_active?: boolean
          slot_duration_min?: number
          start_time?: string
          timezone?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: []
      }
      finance_partner_bookings: {
        Row: {
          booked_by: string
          cancelled_reason: string | null
          client_id: string | null
          contact_email: string | null
          contact_name: string | null
          created_at: string
          end_at: string
          finance_user_id: string
          id: string
          meeting_type: string
          meeting_url: string | null
          metadata: Json
          notes: string | null
          purchase_file_id: string | null
          start_at: string
          status: string
          timezone: string
          topic: string | null
          updated_at: string
        }
        Insert: {
          booked_by?: string
          cancelled_reason?: string | null
          client_id?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          end_at: string
          finance_user_id: string
          id?: string
          meeting_type?: string
          meeting_url?: string | null
          metadata?: Json
          notes?: string | null
          purchase_file_id?: string | null
          start_at: string
          status?: string
          timezone?: string
          topic?: string | null
          updated_at?: string
        }
        Update: {
          booked_by?: string
          cancelled_reason?: string | null
          client_id?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          end_at?: string
          finance_user_id?: string
          id?: string
          meeting_type?: string
          meeting_url?: string | null
          metadata?: Json
          notes?: string | null
          purchase_file_id?: string | null
          start_at?: string
          status?: string
          timezone?: string
          topic?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_partner_bookings_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_partner_bookings_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      finance_partner_branding: {
        Row: {
          accent_hsl: string | null
          company_display_name: string | null
          created_at: string
          finance_contact_id: string
          id: string
          logo_storage_path: string | null
          tagline: string | null
          updated_at: string
          updated_by_finance_user_id: string | null
        }
        Insert: {
          accent_hsl?: string | null
          company_display_name?: string | null
          created_at?: string
          finance_contact_id: string
          id?: string
          logo_storage_path?: string | null
          tagline?: string | null
          updated_at?: string
          updated_by_finance_user_id?: string | null
        }
        Update: {
          accent_hsl?: string | null
          company_display_name?: string | null
          created_at?: string
          finance_contact_id?: string
          id?: string
          logo_storage_path?: string | null
          tagline?: string | null
          updated_at?: string
          updated_by_finance_user_id?: string | null
        }
        Relationships: []
      }
      finance_partner_commissions: {
        Row: {
          basis_amount: number
          build_payment_id: string | null
          client_id: string | null
          client_name_snapshot: string | null
          commission_basis: string
          created_at: string
          created_by: string | null
          deal_id: string | null
          deal_type_snapshot: string | null
          finance_contact_id: string
          gross_amount: number
          gst_amount: number
          id: string
          invoice_date: string | null
          invoice_ref: string | null
          milestone: string | null
          net_amount: number
          notes: string | null
          paid_at: string | null
          partner_company_snapshot: string | null
          partner_name_snapshot: string | null
          purchase_file_id: string | null
          rate_pct: number
          statement_id: string | null
          status: string
          trigger_event: string | null
          updated_at: string
        }
        Insert: {
          basis_amount?: number
          build_payment_id?: string | null
          client_id?: string | null
          client_name_snapshot?: string | null
          commission_basis?: string
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          deal_type_snapshot?: string | null
          finance_contact_id: string
          gross_amount?: number
          gst_amount?: number
          id?: string
          invoice_date?: string | null
          invoice_ref?: string | null
          milestone?: string | null
          net_amount?: number
          notes?: string | null
          paid_at?: string | null
          partner_company_snapshot?: string | null
          partner_name_snapshot?: string | null
          purchase_file_id?: string | null
          rate_pct?: number
          statement_id?: string | null
          status?: string
          trigger_event?: string | null
          updated_at?: string
        }
        Update: {
          basis_amount?: number
          build_payment_id?: string | null
          client_id?: string | null
          client_name_snapshot?: string | null
          commission_basis?: string
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          deal_type_snapshot?: string | null
          finance_contact_id?: string
          gross_amount?: number
          gst_amount?: number
          id?: string
          invoice_date?: string | null
          invoice_ref?: string | null
          milestone?: string | null
          net_amount?: number
          notes?: string | null
          paid_at?: string | null
          partner_company_snapshot?: string | null
          partner_name_snapshot?: string | null
          purchase_file_id?: string | null
          rate_pct?: number
          statement_id?: string | null
          status?: string
          trigger_event?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_partner_commissions_build_payment_id_fkey"
            columns: ["build_payment_id"]
            isOneToOne: false
            referencedRelation: "build_progress_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_partner_commissions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_partner_commissions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_partner_commissions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "client_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_partner_commissions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["client_deal_id"]
          },
          {
            foreignKeyName: "finance_partner_commissions_finance_contact_id_fkey"
            columns: ["finance_contact_id"]
            isOneToOne: false
            referencedRelation: "finance_agent_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_partner_commissions_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_partner_commissions_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
          {
            foreignKeyName: "fpc_statement_fk"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "finance_partner_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_partner_daily_activity: {
        Row: {
          action_count: number
          activity_date: string
          created_at: string
          finance_contact_id: string
          first_action_at: string
          id: string
          last_action_at: string
          metadata: Json
        }
        Insert: {
          action_count?: number
          activity_date: string
          created_at?: string
          finance_contact_id: string
          first_action_at?: string
          id?: string
          last_action_at?: string
          metadata?: Json
        }
        Update: {
          action_count?: number
          activity_date?: string
          created_at?: string
          finance_contact_id?: string
          first_action_at?: string
          id?: string
          last_action_at?: string
          metadata?: Json
        }
        Relationships: []
      }
      finance_partner_engagement_badges: {
        Row: {
          badge_key: string
          earned_at: string
          finance_contact_id: string
          id: string
          metadata: Json
        }
        Insert: {
          badge_key: string
          earned_at?: string
          finance_contact_id: string
          id?: string
          metadata?: Json
        }
        Update: {
          badge_key?: string
          earned_at?: string
          finance_contact_id?: string
          id?: string
          metadata?: Json
        }
        Relationships: []
      }
      finance_partner_goals: {
        Row: {
          commission_target_net: number | null
          created_at: string
          created_by_finance_user_id: string | null
          finance_contact_id: string
          id: string
          month_start: string
          notes: string | null
          settlement_target_amount: number | null
          settlement_target_count: number | null
          updated_at: string
        }
        Insert: {
          commission_target_net?: number | null
          created_at?: string
          created_by_finance_user_id?: string | null
          finance_contact_id: string
          id?: string
          month_start: string
          notes?: string | null
          settlement_target_amount?: number | null
          settlement_target_count?: number | null
          updated_at?: string
        }
        Update: {
          commission_target_net?: number | null
          created_at?: string
          created_by_finance_user_id?: string | null
          finance_contact_id?: string
          id?: string
          month_start?: string
          notes?: string | null
          settlement_target_amount?: number | null
          settlement_target_count?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      finance_partner_message_templates: {
        Row: {
          body: string
          category: string | null
          created_at: string
          id: string
          is_shared: boolean
          kind: string
          last_used_at: string | null
          merge_tags: string[]
          owner_finance_contact_id: string | null
          title: string
          updated_at: string
          use_count: number
        }
        Insert: {
          body: string
          category?: string | null
          created_at?: string
          id?: string
          is_shared?: boolean
          kind: string
          last_used_at?: string | null
          merge_tags?: string[]
          owner_finance_contact_id?: string | null
          title: string
          updated_at?: string
          use_count?: number
        }
        Update: {
          body?: string
          category?: string | null
          created_at?: string
          id?: string
          is_shared?: boolean
          kind?: string
          last_used_at?: string | null
          merge_tags?: string[]
          owner_finance_contact_id?: string | null
          title?: string
          updated_at?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "finance_partner_message_templates_owner_finance_contact_id_fkey"
            columns: ["owner_finance_contact_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_partner_notification_prefs: {
        Row: {
          channels: string[]
          created_at: string
          event_type: string
          finance_contact_id: string
          id: string
          is_enabled: boolean
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          channels?: string[]
          created_at?: string
          event_type: string
          finance_contact_id: string
          id?: string
          is_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          channels?: string[]
          created_at?: string
          event_type?: string
          finance_contact_id?: string
          id?: string
          is_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      finance_partner_snoozes: {
        Row: {
          cleared_at: string | null
          client_id: string | null
          created_at: string
          finance_contact_id: string
          id: string
          notified: boolean
          purchase_file_id: string | null
          raw_input: string | null
          reason: string | null
          scope: string
          snooze_until: string
          updated_at: string
        }
        Insert: {
          cleared_at?: string | null
          client_id?: string | null
          created_at?: string
          finance_contact_id: string
          id?: string
          notified?: boolean
          purchase_file_id?: string | null
          raw_input?: string | null
          reason?: string | null
          scope?: string
          snooze_until: string
          updated_at?: string
        }
        Update: {
          cleared_at?: string | null
          client_id?: string | null
          created_at?: string
          finance_contact_id?: string
          id?: string
          notified?: boolean
          purchase_file_id?: string | null
          raw_input?: string | null
          reason?: string | null
          scope?: string
          snooze_until?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_partner_snoozes_finance_contact_id_fkey"
            columns: ["finance_contact_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_partner_snoozes_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_partner_snoozes_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      finance_partner_statement_lines: {
        Row: {
          accrual_date: string | null
          basis_snapshot: string | null
          client_name_snapshot: string | null
          commission_id: string
          created_at: string
          deal_type_snapshot: string | null
          gross_snapshot: number | null
          gst_snapshot: number | null
          id: string
          net_snapshot: number | null
          rate_pct_snapshot: number | null
          statement_id: string
          trigger_event_snapshot: string | null
        }
        Insert: {
          accrual_date?: string | null
          basis_snapshot?: string | null
          client_name_snapshot?: string | null
          commission_id: string
          created_at?: string
          deal_type_snapshot?: string | null
          gross_snapshot?: number | null
          gst_snapshot?: number | null
          id?: string
          net_snapshot?: number | null
          rate_pct_snapshot?: number | null
          statement_id: string
          trigger_event_snapshot?: string | null
        }
        Update: {
          accrual_date?: string | null
          basis_snapshot?: string | null
          client_name_snapshot?: string | null
          commission_id?: string
          created_at?: string
          deal_type_snapshot?: string | null
          gross_snapshot?: number | null
          gst_snapshot?: number | null
          id?: string
          net_snapshot?: number | null
          rate_pct_snapshot?: number | null
          statement_id?: string
          trigger_event_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_partner_statement_lines_commission_id_fkey"
            columns: ["commission_id"]
            isOneToOne: false
            referencedRelation: "finance_partner_commissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_partner_statement_lines_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "finance_partner_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_partner_statements: {
        Row: {
          created_at: string
          finance_contact_id: string
          id: string
          issued_at: string | null
          issued_by: string | null
          line_count: number
          notes: string | null
          paid_at: string | null
          paid_reference: string | null
          partner_company_snapshot: string | null
          partner_name_snapshot: string | null
          pdf_storage_path: string | null
          period_end: string
          period_start: string
          remittance_csv_path: string | null
          status: string
          total_gross: number
          total_gst: number
          total_net: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          finance_contact_id: string
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          line_count?: number
          notes?: string | null
          paid_at?: string | null
          paid_reference?: string | null
          partner_company_snapshot?: string | null
          partner_name_snapshot?: string | null
          pdf_storage_path?: string | null
          period_end: string
          period_start: string
          remittance_csv_path?: string | null
          status?: string
          total_gross?: number
          total_gst?: number
          total_net?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          finance_contact_id?: string
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          line_count?: number
          notes?: string | null
          paid_at?: string | null
          paid_reference?: string | null
          partner_company_snapshot?: string | null
          partner_name_snapshot?: string | null
          pdf_storage_path?: string | null
          period_end?: string
          period_start?: string
          remittance_csv_path?: string | null
          status?: string
          total_gross?: number
          total_gst?: number
          total_net?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_partner_statements_finance_contact_id_fkey"
            columns: ["finance_contact_id"]
            isOneToOne: false
            referencedRelation: "finance_agent_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_partner_statements_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_partner_ui_prefs: {
        Row: {
          created_at: string
          default_landing: string
          density: string
          finance_user_id: string
          mobile_optimized: boolean
          prefs: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_landing?: string
          density?: string
          finance_user_id: string
          mobile_optimized?: boolean
          prefs?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_landing?: string
          density?: string
          finance_user_id?: string
          mobile_optimized?: boolean
          prefs?: Json
          updated_at?: string
        }
        Relationships: []
      }
      finance_portal_activity_log: {
        Row: {
          action: string
          actor_type: string
          actor_user_id: string | null
          client_deal_id: string | null
          client_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          finance_user_id: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          purchase_file_id: string | null
          user_agent: string | null
          visible_to_client: boolean
          visible_to_command_centre: boolean
          visible_to_finance_partner: boolean
        }
        Insert: {
          action: string
          actor_type?: string
          actor_user_id?: string | null
          client_deal_id?: string | null
          client_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          finance_user_id?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          purchase_file_id?: string | null
          user_agent?: string | null
          visible_to_client?: boolean
          visible_to_command_centre?: boolean
          visible_to_finance_partner?: boolean
        }
        Update: {
          action?: string
          actor_type?: string
          actor_user_id?: string | null
          client_deal_id?: string | null
          client_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          finance_user_id?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          purchase_file_id?: string | null
          user_agent?: string | null
          visible_to_client?: boolean
          visible_to_command_centre?: boolean
          visible_to_finance_partner?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "finance_portal_activity_log_client_deal_id_fkey"
            columns: ["client_deal_id"]
            isOneToOne: false
            referencedRelation: "client_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_activity_log_client_deal_id_fkey"
            columns: ["client_deal_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["client_deal_id"]
          },
          {
            foreignKeyName: "finance_portal_activity_log_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_activity_log_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      finance_portal_client_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          auto_link_source: string | null
          auto_linked: boolean
          client_id: string
          finance_user_id: string
          id: string
          permissions: Json
          purchase_file_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          auto_link_source?: string | null
          auto_linked?: boolean
          client_id: string
          finance_user_id: string
          id?: string
          permissions?: Json
          purchase_file_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          auto_link_source?: string | null
          auto_linked?: boolean
          client_id?: string
          finance_user_id?: string
          id?: string
          permissions?: Json
          purchase_file_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_portal_client_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_client_assignments_finance_user_id_fkey"
            columns: ["finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_client_assignments_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_client_assignments_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      finance_portal_default_permissions: {
        Row: {
          id: string
          permissions: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          permissions?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          permissions?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      finance_portal_doc_message_templates: {
        Row: {
          body: string
          created_at: string
          finance_user_id: string | null
          id: string
          is_active: boolean
          name: string
          reason: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          finance_user_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          reason: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          finance_user_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          reason?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_portal_doc_message_templates_finance_user_id_fkey"
            columns: ["finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_portal_documents: {
        Row: {
          category: string
          client_deal_id: string | null
          client_id: string
          conflict_group: string | null
          conflict_reason: string | null
          content_hash: string | null
          created_at: string
          dedupe_key: string | null
          deleted_at: string | null
          description: string | null
          file_size: number
          id: string
          last_synced_at: string | null
          mime_type: string
          original_filename: string
          purchase_file_id: string | null
          source_actor_name: string | null
          source_actor_type:
            | Database["public"]["Enums"]["record_source_actor_type"]
            | null
          source_details: Json
          source_reference: string | null
          source_surface:
            | Database["public"]["Enums"]["record_source_surface"]
            | null
          storage_path: string
          supersedes_entity_id: string | null
          sync_status: Database["public"]["Enums"]["sync_status_type"]
          updated_at: string
          uploaded_by_finance_user_id: string | null
          uploaded_by_internal_user_id: string | null
          uploader_type: string
          version_group_id: string | null
          version_number: number
          visible_to_client: boolean
        }
        Insert: {
          category?: string
          client_deal_id?: string | null
          client_id: string
          conflict_group?: string | null
          conflict_reason?: string | null
          content_hash?: string | null
          created_at?: string
          dedupe_key?: string | null
          deleted_at?: string | null
          description?: string | null
          file_size?: number
          id?: string
          last_synced_at?: string | null
          mime_type?: string
          original_filename: string
          purchase_file_id?: string | null
          source_actor_name?: string | null
          source_actor_type?:
            | Database["public"]["Enums"]["record_source_actor_type"]
            | null
          source_details?: Json
          source_reference?: string | null
          source_surface?:
            | Database["public"]["Enums"]["record_source_surface"]
            | null
          storage_path: string
          supersedes_entity_id?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status_type"]
          updated_at?: string
          uploaded_by_finance_user_id?: string | null
          uploaded_by_internal_user_id?: string | null
          uploader_type?: string
          version_group_id?: string | null
          version_number?: number
          visible_to_client?: boolean
        }
        Update: {
          category?: string
          client_deal_id?: string | null
          client_id?: string
          conflict_group?: string | null
          conflict_reason?: string | null
          content_hash?: string | null
          created_at?: string
          dedupe_key?: string | null
          deleted_at?: string | null
          description?: string | null
          file_size?: number
          id?: string
          last_synced_at?: string | null
          mime_type?: string
          original_filename?: string
          purchase_file_id?: string | null
          source_actor_name?: string | null
          source_actor_type?:
            | Database["public"]["Enums"]["record_source_actor_type"]
            | null
          source_details?: Json
          source_reference?: string | null
          source_surface?:
            | Database["public"]["Enums"]["record_source_surface"]
            | null
          storage_path?: string
          supersedes_entity_id?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status_type"]
          updated_at?: string
          uploaded_by_finance_user_id?: string | null
          uploaded_by_internal_user_id?: string | null
          uploader_type?: string
          version_group_id?: string | null
          version_number?: number
          visible_to_client?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "finance_portal_documents_client_deal_id_fkey"
            columns: ["client_deal_id"]
            isOneToOne: false
            referencedRelation: "client_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_documents_client_deal_id_fkey"
            columns: ["client_deal_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["client_deal_id"]
          },
          {
            foreignKeyName: "finance_portal_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_documents_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_documents_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
          {
            foreignKeyName: "finance_portal_documents_uploaded_by_finance_user_id_fkey"
            columns: ["uploaded_by_finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_documents_uploaded_by_internal_user_id_fkey"
            columns: ["uploaded_by_internal_user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_portal_handoff_tokens: {
        Row: {
          client_id: string
          consumed_at: string | null
          consumed_session_id: string | null
          created_at: string
          expires_at: string
          finance_contact_id: string | null
          finance_user_id: string | null
          id: string
          ip_address: string | null
          is_readonly: boolean
          staff_user_id: string | null
          target_portal_user_id: string | null
          token: string
          user_agent: string | null
        }
        Insert: {
          client_id: string
          consumed_at?: string | null
          consumed_session_id?: string | null
          created_at?: string
          expires_at?: string
          finance_contact_id?: string | null
          finance_user_id?: string | null
          id?: string
          ip_address?: string | null
          is_readonly?: boolean
          staff_user_id?: string | null
          target_portal_user_id?: string | null
          token: string
          user_agent?: string | null
        }
        Update: {
          client_id?: string
          consumed_at?: string | null
          consumed_session_id?: string | null
          created_at?: string
          expires_at?: string
          finance_contact_id?: string | null
          finance_user_id?: string | null
          id?: string
          ip_address?: string | null
          is_readonly?: boolean
          staff_user_id?: string | null
          target_portal_user_id?: string | null
          token?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_portal_handoff_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_handoff_tokens_finance_user_id_fkey"
            columns: ["finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_handoff_tokens_target_portal_user_id_fkey"
            columns: ["target_portal_user_id"]
            isOneToOne: false
            referencedRelation: "client_portal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_portal_messages: {
        Row: {
          allocation_status: Database["public"]["Enums"]["message_allocation_status"]
          attachment_filename: string | null
          attachment_mime: string | null
          attachment_path: string | null
          attachment_size_bytes: number | null
          body: string
          client_id: string
          command_owner_user_id: string | null
          created_at: string
          finance_user_id: string | null
          id: string
          is_read_by_partner: boolean
          is_read_by_staff: boolean
          notification_status: Json
          permission_status: Json
          read_by_partner_at: string | null
          read_by_staff_at: string | null
          sender_name: string | null
          sender_type: string
          staff_user_id: string | null
          thread_id: string
          thread_type: string
          visibility_scope: Database["public"]["Enums"]["message_visibility_scope"]
        }
        Insert: {
          allocation_status?: Database["public"]["Enums"]["message_allocation_status"]
          attachment_filename?: string | null
          attachment_mime?: string | null
          attachment_path?: string | null
          attachment_size_bytes?: number | null
          body: string
          client_id: string
          command_owner_user_id?: string | null
          created_at?: string
          finance_user_id?: string | null
          id?: string
          is_read_by_partner?: boolean
          is_read_by_staff?: boolean
          notification_status?: Json
          permission_status?: Json
          read_by_partner_at?: string | null
          read_by_staff_at?: string | null
          sender_name?: string | null
          sender_type: string
          staff_user_id?: string | null
          thread_id: string
          thread_type?: string
          visibility_scope?: Database["public"]["Enums"]["message_visibility_scope"]
        }
        Update: {
          allocation_status?: Database["public"]["Enums"]["message_allocation_status"]
          attachment_filename?: string | null
          attachment_mime?: string | null
          attachment_path?: string | null
          attachment_size_bytes?: number | null
          body?: string
          client_id?: string
          command_owner_user_id?: string | null
          created_at?: string
          finance_user_id?: string | null
          id?: string
          is_read_by_partner?: boolean
          is_read_by_staff?: boolean
          notification_status?: Json
          permission_status?: Json
          read_by_partner_at?: string | null
          read_by_staff_at?: string | null
          sender_name?: string | null
          sender_type?: string
          staff_user_id?: string | null
          thread_id?: string
          thread_type?: string
          visibility_scope?: Database["public"]["Enums"]["message_visibility_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "finance_portal_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_messages_command_owner_user_id_fkey"
            columns: ["command_owner_user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_messages_finance_user_id_fkey"
            columns: ["finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_messages_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_portal_notifications: {
        Row: {
          body: string | null
          client_id: string | null
          created_at: string
          id: string
          is_read: boolean
          link_path: string | null
          metadata: Json | null
          notification_type: string
          portal_user_id: string
          read_at: string | null
          title: string
        }
        Insert: {
          body?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link_path?: string | null
          metadata?: Json | null
          notification_type: string
          portal_user_id: string
          read_at?: string | null
          title: string
        }
        Update: {
          body?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link_path?: string | null
          metadata?: Json | null
          notification_type?: string
          portal_user_id?: string
          read_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_portal_notifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_notifications_portal_user_id_fkey"
            columns: ["portal_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_portal_nudge_sends: {
        Row: {
          channel: string
          error: string | null
          id: string
          message_id: string | null
          sent_at: string
          sequence_id: string
          step_index: number
        }
        Insert: {
          channel?: string
          error?: string | null
          id?: string
          message_id?: string | null
          sent_at?: string
          sequence_id: string
          step_index: number
        }
        Update: {
          channel?: string
          error?: string | null
          id?: string
          message_id?: string | null
          sent_at?: string
          sequence_id?: string
          step_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "finance_portal_nudge_sends_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_nudge_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_portal_nudge_sequences: {
        Row: {
          client_id: string
          completed_at: string | null
          created_at: string
          current_step: number
          id: string
          last_step_sent_at: string | null
          metadata: Json
          next_run_at: string | null
          pause_reason: string | null
          purchase_file_id: string
          started_at: string
          started_by_finance_user_id: string | null
          status: string
          template_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          created_at?: string
          current_step?: number
          id?: string
          last_step_sent_at?: string | null
          metadata?: Json
          next_run_at?: string | null
          pause_reason?: string | null
          purchase_file_id: string
          started_at?: string
          started_by_finance_user_id?: string | null
          status?: string
          template_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          created_at?: string
          current_step?: number
          id?: string
          last_step_sent_at?: string | null
          metadata?: Json
          next_run_at?: string | null
          pause_reason?: string | null
          purchase_file_id?: string
          started_at?: string
          started_by_finance_user_id?: string | null
          status?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_portal_nudge_sequences_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_nudge_sequences_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_nudge_sequences_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
          {
            foreignKeyName: "finance_portal_nudge_sequences_started_by_finance_user_id_fkey"
            columns: ["started_by_finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_nudge_sequences_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_nudge_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_portal_nudge_templates: {
        Row: {
          created_at: string
          description: string | null
          finance_user_id: string | null
          id: string
          is_active: boolean
          kind: string
          name: string
          steps: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          finance_user_id?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name: string
          steps?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          finance_user_id?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          steps?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_portal_nudge_templates_finance_user_id_fkey"
            columns: ["finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_portal_pf_watchers: {
        Row: {
          created_at: string
          finance_user_id: string
          id: string
          purchase_file_id: string
        }
        Insert: {
          created_at?: string
          finance_user_id: string
          id?: string
          purchase_file_id: string
        }
        Update: {
          created_at?: string
          finance_user_id?: string
          id?: string
          purchase_file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_portal_pf_watchers_finance_user_id_fkey"
            columns: ["finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_pf_watchers_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_pf_watchers_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      finance_portal_saved_views: {
        Row: {
          created_at: string
          filters: Json
          finance_user_id: string
          id: string
          is_default: boolean
          name: string
          scope: string
          sort: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          finance_user_id: string
          id?: string
          is_default?: boolean
          name: string
          scope: string
          sort?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          filters?: Json
          finance_user_id?: string
          id?: string
          is_default?: boolean
          name?: string
          scope?: string
          sort?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_portal_saved_views_finance_user_id_fkey"
            columns: ["finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_portal_threads: {
        Row: {
          allocation_status: Database["public"]["Enums"]["message_allocation_status"]
          client_id: string
          command_owner_user_id: string | null
          created_at: string
          finance_allocated: boolean
          finance_user_id: string
          id: string
          is_archived: boolean
          last_message_at: string | null
          last_message_preview: string | null
          permission_status: Json
          subject: string | null
          thread_type: string
          unread_count_partner: number
          unread_count_staff: number
          updated_at: string
          visibility_scope: Database["public"]["Enums"]["message_visibility_scope"]
        }
        Insert: {
          allocation_status?: Database["public"]["Enums"]["message_allocation_status"]
          client_id: string
          command_owner_user_id?: string | null
          created_at?: string
          finance_allocated?: boolean
          finance_user_id: string
          id?: string
          is_archived?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          permission_status?: Json
          subject?: string | null
          thread_type?: string
          unread_count_partner?: number
          unread_count_staff?: number
          updated_at?: string
          visibility_scope?: Database["public"]["Enums"]["message_visibility_scope"]
        }
        Update: {
          allocation_status?: Database["public"]["Enums"]["message_allocation_status"]
          client_id?: string
          command_owner_user_id?: string | null
          created_at?: string
          finance_allocated?: boolean
          finance_user_id?: string
          id?: string
          is_archived?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          permission_status?: Json
          subject?: string | null
          thread_type?: string
          unread_count_partner?: number
          unread_count_staff?: number
          updated_at?: string
          visibility_scope?: Database["public"]["Enums"]["message_visibility_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "finance_portal_threads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_threads_command_owner_user_id_fkey"
            columns: ["command_owner_user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_portal_threads_finance_user_id_fkey"
            columns: ["finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_portal_users: {
        Row: {
          created_at: string
          email: string
          failed_login_attempts: number
          finance_contact_id: string
          global_permissions: Json | null
          has_accepted_terms: boolean
          has_completed_onboarding: boolean
          id: string
          invite_accepted_at: string | null
          invite_sent_at: string | null
          invite_token: string | null
          invite_token_expires_at: string | null
          invited_by: string | null
          is_active: boolean
          last_briefing_sent_at: string | null
          last_eod_sent_at: string | null
          last_login_at: string | null
          last_seen_at: string | null
          locked_until: string | null
          must_change_password: boolean
          password_hash: string | null
          reset_token: string | null
          reset_token_attempts: number
          reset_token_expires_at: string | null
          revoked_at: string | null
          revoked_by: string | null
          session_expires_at: string | null
          session_idle_expires_at: string | null
          session_ip_address: string | null
          session_last_used_at: string | null
          session_revocation_reason: string | null
          session_token: string | null
          session_token_hash: string | null
          session_user_agent: string | null
          streak_freeze_until: string | null
          terms_accepted_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          failed_login_attempts?: number
          finance_contact_id: string
          global_permissions?: Json | null
          has_accepted_terms?: boolean
          has_completed_onboarding?: boolean
          id?: string
          invite_accepted_at?: string | null
          invite_sent_at?: string | null
          invite_token?: string | null
          invite_token_expires_at?: string | null
          invited_by?: string | null
          is_active?: boolean
          last_briefing_sent_at?: string | null
          last_eod_sent_at?: string | null
          last_login_at?: string | null
          last_seen_at?: string | null
          locked_until?: string | null
          must_change_password?: boolean
          password_hash?: string | null
          reset_token?: string | null
          reset_token_attempts?: number
          reset_token_expires_at?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          session_expires_at?: string | null
          session_idle_expires_at?: string | null
          session_ip_address?: string | null
          session_last_used_at?: string | null
          session_revocation_reason?: string | null
          session_token?: string | null
          session_token_hash?: string | null
          session_user_agent?: string | null
          streak_freeze_until?: string | null
          terms_accepted_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          failed_login_attempts?: number
          finance_contact_id?: string
          global_permissions?: Json | null
          has_accepted_terms?: boolean
          has_completed_onboarding?: boolean
          id?: string
          invite_accepted_at?: string | null
          invite_sent_at?: string | null
          invite_token?: string | null
          invite_token_expires_at?: string | null
          invited_by?: string | null
          is_active?: boolean
          last_briefing_sent_at?: string | null
          last_eod_sent_at?: string | null
          last_login_at?: string | null
          last_seen_at?: string | null
          locked_until?: string | null
          must_change_password?: boolean
          password_hash?: string | null
          reset_token?: string | null
          reset_token_attempts?: number
          reset_token_expires_at?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          session_expires_at?: string | null
          session_idle_expires_at?: string | null
          session_ip_address?: string | null
          session_last_used_at?: string | null
          session_revocation_reason?: string | null
          session_token?: string | null
          session_token_hash?: string | null
          session_user_agent?: string | null
          streak_freeze_until?: string | null
          terms_accepted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_portal_users_finance_contact_id_fkey"
            columns: ["finance_contact_id"]
            isOneToOne: true
            referencedRelation: "finance_agent_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      game_plan_actions: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          display_order: number
          due_date: string | null
          id: string
          is_done: boolean
          label: string
          milestone_id: string | null
          phase_id: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          display_order?: number
          due_date?: string | null
          id?: string
          is_done?: boolean
          label: string
          milestone_id?: string | null
          phase_id: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          display_order?: number
          due_date?: string | null
          id?: string
          is_done?: boolean
          label?: string
          milestone_id?: string | null
          phase_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_plan_actions_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "game_plan_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_plan_actions_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "game_plan_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      game_plan_kpis: {
        Row: {
          created_at: string
          current_value: number
          display_order: number
          icon: string | null
          id: string
          metric_name: string
          phase_id: string
          target_value: number
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_value?: number
          display_order?: number
          icon?: string | null
          id?: string
          metric_name: string
          phase_id: string
          target_value?: number
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_value?: number
          display_order?: number
          icon?: string | null
          id?: string
          metric_name?: string
          phase_id?: string
          target_value?: number
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_plan_kpis_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "game_plan_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      game_plan_milestones: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          display_order: number
          due_date: string | null
          id: string
          owner: string | null
          phase_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          due_date?: string | null
          id?: string
          owner?: string | null
          phase_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          due_date?: string | null
          id?: string
          owner?: string | null
          phase_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_plan_milestones_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "game_plan_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      game_plan_notes: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: string
          is_pinned: boolean
          note_type: string
          phase_id: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_pinned?: boolean
          note_type?: string
          phase_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_pinned?: boolean
          note_type?: string
          phase_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_plan_notes_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "game_plan_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      game_plan_phases: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          display_order: number
          end_date: string | null
          icon: string | null
          id: string
          name: string
          plan_id: string
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          end_date?: string | null
          icon?: string | null
          id?: string
          name: string
          plan_id: string
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          end_date?: string | null
          icon?: string | null
          id?: string
          name?: string
          plan_id?: string
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_plan_phases_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "game_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      game_plans: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string | null
          icon: string | null
          id: string
          name: string
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          icon?: string | null
          id?: string
          name: string
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          icon?: string | null
          id?: string
          name?: string
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      gamma_agreement_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          gamma_template_id: string
          id: string
          is_active: boolean | null
          is_default: boolean | null
          name: string
          placeholder_mappings: Json
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          gamma_template_id: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name: string
          placeholder_mappings?: Json
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          gamma_template_id?: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          placeholder_mappings?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      generated_documents: {
        Row: {
          audit: Json | null
          client_id: string | null
          created_at: string
          deal_id: string | null
          docusign_envelope_id: string | null
          docusign_status: string | null
          generated_by: string | null
          generation_payload: Json | null
          id: string
          pdf_storage_path: string | null
          sent_at: string | null
          sent_to: string[] | null
          shared_with_client: boolean
          signed_at: string | null
          signed_pdf_storage_path: string | null
          signing_layout: Json
          signing_prepared_at: string | null
          signing_recipients: Json
          status: Database["public"]["Enums"]["generated_doc_status"]
          submission_id: string | null
          template_id: string | null
          template_type: Database["public"]["Enums"]["template_doc_type"]
          title: string
          updated_at: string
          viewed_at: string | null
          voided_at: string | null
          voided_reason: string | null
        }
        Insert: {
          audit?: Json | null
          client_id?: string | null
          created_at?: string
          deal_id?: string | null
          docusign_envelope_id?: string | null
          docusign_status?: string | null
          generated_by?: string | null
          generation_payload?: Json | null
          id?: string
          pdf_storage_path?: string | null
          sent_at?: string | null
          sent_to?: string[] | null
          shared_with_client?: boolean
          signed_at?: string | null
          signed_pdf_storage_path?: string | null
          signing_layout?: Json
          signing_prepared_at?: string | null
          signing_recipients?: Json
          status?: Database["public"]["Enums"]["generated_doc_status"]
          submission_id?: string | null
          template_id?: string | null
          template_type?: Database["public"]["Enums"]["template_doc_type"]
          title: string
          updated_at?: string
          viewed_at?: string | null
          voided_at?: string | null
          voided_reason?: string | null
        }
        Update: {
          audit?: Json | null
          client_id?: string | null
          created_at?: string
          deal_id?: string | null
          docusign_envelope_id?: string | null
          docusign_status?: string | null
          generated_by?: string | null
          generation_payload?: Json | null
          id?: string
          pdf_storage_path?: string | null
          sent_at?: string | null
          sent_to?: string[] | null
          shared_with_client?: boolean
          signed_at?: string | null
          signed_pdf_storage_path?: string | null
          signing_layout?: Json
          signing_prepared_at?: string | null
          signing_recipients?: Json
          status?: Database["public"]["Enums"]["generated_doc_status"]
          submission_id?: string | null
          template_id?: string | null
          template_type?: Database["public"]["Enums"]["template_doc_type"]
          title?: string
          updated_at?: string
          viewed_at?: string | null
          voided_at?: string | null
          voided_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "client_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["client_deal_id"]
          },
          {
            foreignKeyName: "generated_documents_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "lender_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_reports: {
        Row: {
          analytics: Json
          chart_images: Json | null
          chart_urls: Json
          config: Json
          created_at: string
          description: string | null
          error_details: string | null
          file_name: string | null
          file_size: number | null
          generated_at: string | null
          generated_by: string | null
          generation_source: string | null
          id: string
          insights: Json
          kpis: Json
          listing_count: number
          pdf_bucket: string | null
          pdf_path: string | null
          period_end: string | null
          period_start: string | null
          report_type: string | null
          source_record_count: number | null
          source_snapshot: Json | null
          status: string | null
          title: string
          version: number | null
          webhook_sent: boolean | null
          webhook_url: string | null
          workspace_id: string | null
        }
        Insert: {
          analytics: Json
          chart_images?: Json | null
          chart_urls: Json
          config: Json
          created_at?: string
          description?: string | null
          error_details?: string | null
          file_name?: string | null
          file_size?: number | null
          generated_at?: string | null
          generated_by?: string | null
          generation_source?: string | null
          id?: string
          insights: Json
          kpis: Json
          listing_count: number
          pdf_bucket?: string | null
          pdf_path?: string | null
          period_end?: string | null
          period_start?: string | null
          report_type?: string | null
          source_record_count?: number | null
          source_snapshot?: Json | null
          status?: string | null
          title: string
          version?: number | null
          webhook_sent?: boolean | null
          webhook_url?: string | null
          workspace_id?: string | null
        }
        Update: {
          analytics?: Json
          chart_images?: Json | null
          chart_urls?: Json
          config?: Json
          created_at?: string
          description?: string | null
          error_details?: string | null
          file_name?: string | null
          file_size?: number | null
          generated_at?: string | null
          generated_by?: string | null
          generation_source?: string | null
          id?: string
          insights?: Json
          kpis?: Json
          listing_count?: number
          pdf_bucket?: string | null
          pdf_path?: string | null
          period_end?: string | null
          period_start?: string | null
          report_type?: string | null
          source_record_count?: number | null
          source_snapshot?: Json | null
          status?: string | null
          title?: string
          version?: number | null
          webhook_sent?: boolean | null
          webhook_url?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_reports_generated_by_custom_users_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_account_config: {
        Row: {
          cutover_job_id: string | null
          default_account: string
          id: boolean
          legacy_disabled_at: string | null
          updated_at: string
        }
        Insert: {
          cutover_job_id?: string | null
          default_account?: string
          id?: boolean
          legacy_disabled_at?: string | null
          updated_at?: string
        }
        Update: {
          cutover_job_id?: string | null
          default_account?: string
          id?: boolean
          legacy_disabled_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ghl_client_opportunities: {
        Row: {
          client_id: string
          created_at: string | null
          custom_fields: Json | null
          follow_up_date: string | null
          ghl_contact_id: string
          ghl_created_at: string | null
          ghl_opportunity_id: string
          ghl_updated_at: string | null
          id: string
          monetary_value: number | null
          notes: string | null
          opportunity_name: string | null
          opportunity_status: string | null
          pipeline_id: string | null
          pipeline_name: string | null
          stage_id: string | null
          stage_name: string | null
          synced_at: string | null
          updated_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          custom_fields?: Json | null
          follow_up_date?: string | null
          ghl_contact_id: string
          ghl_created_at?: string | null
          ghl_opportunity_id: string
          ghl_updated_at?: string | null
          id?: string
          monetary_value?: number | null
          notes?: string | null
          opportunity_name?: string | null
          opportunity_status?: string | null
          pipeline_id?: string | null
          pipeline_name?: string | null
          stage_id?: string | null
          stage_name?: string | null
          synced_at?: string | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          custom_fields?: Json | null
          follow_up_date?: string | null
          ghl_contact_id?: string
          ghl_created_at?: string | null
          ghl_opportunity_id?: string
          ghl_updated_at?: string | null
          id?: string
          monetary_value?: number | null
          notes?: string | null
          opportunity_name?: string | null
          opportunity_status?: string | null
          pipeline_id?: string | null
          pipeline_name?: string | null
          stage_id?: string | null
          stage_name?: string | null
          synced_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ghl_client_opportunities_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ghl_client_opportunities_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "ghl_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ghl_client_opportunities_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "ghl_pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_contact_workflow_enrollments: {
        Row: {
          account: string
          contact_id: string
          created_at: string
          enrolled_at: string | null
          id: string
          new_contact_id: string | null
          new_workflow_id: string | null
          raw_json: Json | null
          re_enrollment_attempted_at: string | null
          re_enrollment_error: string | null
          re_enrollment_status: string
          status: string | null
          updated_at: string
          workflow_id: string
        }
        Insert: {
          account: string
          contact_id: string
          created_at?: string
          enrolled_at?: string | null
          id?: string
          new_contact_id?: string | null
          new_workflow_id?: string | null
          raw_json?: Json | null
          re_enrollment_attempted_at?: string | null
          re_enrollment_error?: string | null
          re_enrollment_status?: string
          status?: string | null
          updated_at?: string
          workflow_id: string
        }
        Update: {
          account?: string
          contact_id?: string
          created_at?: string
          enrolled_at?: string | null
          id?: string
          new_contact_id?: string | null
          new_workflow_id?: string | null
          raw_json?: Json | null
          re_enrollment_attempted_at?: string | null
          re_enrollment_error?: string | null
          re_enrollment_status?: string
          status?: string | null
          updated_at?: string
          workflow_id?: string
        }
        Relationships: []
      }
      ghl_conversation_messages: {
        Row: {
          attachment_urls: string[] | null
          body: string | null
          channel_type: string
          content_type: string
          conversation_id: string
          created_at: string
          direction: string
          ghl_date_added: string | null
          ghl_message_id: string
          id: string
          message_status: string | null
          new_ghl_message_id: string | null
          recipient_number: string | null
          replay_skipped_reason: string | null
          replayed_at: string | null
          sender_name: string | null
          sender_number: string | null
          updated_at: string
        }
        Insert: {
          attachment_urls?: string[] | null
          body?: string | null
          channel_type?: string
          content_type?: string
          conversation_id: string
          created_at?: string
          direction?: string
          ghl_date_added?: string | null
          ghl_message_id: string
          id?: string
          message_status?: string | null
          new_ghl_message_id?: string | null
          recipient_number?: string | null
          replay_skipped_reason?: string | null
          replayed_at?: string | null
          sender_name?: string | null
          sender_number?: string | null
          updated_at?: string
        }
        Update: {
          attachment_urls?: string[] | null
          body?: string | null
          channel_type?: string
          content_type?: string
          conversation_id?: string
          created_at?: string
          direction?: string
          ghl_date_added?: string | null
          ghl_message_id?: string
          id?: string
          message_status?: string | null
          new_ghl_message_id?: string | null
          recipient_number?: string | null
          replay_skipped_reason?: string | null
          replayed_at?: string | null
          sender_name?: string | null
          sender_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghl_conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ghl_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_conversations: {
        Row: {
          assigned_to: string | null
          channel_type: string
          client_id: string | null
          conversation_status: string
          created_at: string
          ghl_contact_id: string | null
          ghl_conversation_id: string
          id: string
          last_message_body: string | null
          last_message_date: string | null
          last_message_direction: string | null
          last_synced_at: string | null
          new_ghl_conversation_id: string | null
          replayed_at: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          channel_type?: string
          client_id?: string | null
          conversation_status?: string
          created_at?: string
          ghl_contact_id?: string | null
          ghl_conversation_id: string
          id?: string
          last_message_body?: string | null
          last_message_date?: string | null
          last_message_direction?: string | null
          last_synced_at?: string | null
          new_ghl_conversation_id?: string | null
          replayed_at?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          channel_type?: string
          client_id?: string | null
          conversation_status?: string
          created_at?: string
          ghl_contact_id?: string | null
          ghl_conversation_id?: string
          id?: string
          last_message_body?: string | null
          last_message_date?: string | null
          last_message_direction?: string | null
          last_synced_at?: string | null
          new_ghl_conversation_id?: string | null
          replayed_at?: string | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghl_conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_forms: {
        Row: {
          created_at: string
          fields_count: number | null
          form_type: string
          ghl_form_id: string
          id: string
          last_synced_at: string
          location_id: string
          name: string
          raw_payload: Json
          submission_count: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          fields_count?: number | null
          form_type?: string
          ghl_form_id: string
          id?: string
          last_synced_at?: string
          location_id: string
          name: string
          raw_payload?: Json
          submission_count?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          fields_count?: number | null
          form_type?: string
          ghl_form_id?: string
          id?: string
          last_synced_at?: string
          location_id?: string
          name?: string
          raw_payload?: Json
          submission_count?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      ghl_funnel_pages: {
        Row: {
          created_at: string
          full_url: string | null
          funnel_uuid: string | null
          ghl_funnel_id: string
          ghl_page_id: string
          id: string
          last_synced_at: string
          name: string
          page_type: string | null
          position: number | null
          raw_payload: Json
          slug: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_url?: string | null
          funnel_uuid?: string | null
          ghl_funnel_id: string
          ghl_page_id: string
          id?: string
          last_synced_at?: string
          name: string
          page_type?: string | null
          position?: number | null
          raw_payload?: Json
          slug?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_url?: string | null
          funnel_uuid?: string | null
          ghl_funnel_id?: string
          ghl_page_id?: string
          id?: string
          last_synced_at?: string
          name?: string
          page_type?: string | null
          position?: number | null
          raw_payload?: Json
          slug?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghl_funnel_pages_funnel_uuid_fkey"
            columns: ["funnel_uuid"]
            isOneToOne: false
            referencedRelation: "ghl_funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_funnels: {
        Row: {
          created_at: string
          domain: string | null
          ghl_funnel_id: string
          id: string
          last_synced_at: string
          location_id: string
          name: string
          page_count: number | null
          raw_payload: Json
          status: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          domain?: string | null
          ghl_funnel_id: string
          id?: string
          last_synced_at?: string
          location_id: string
          name: string
          page_count?: number | null
          raw_payload?: Json
          status?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          domain?: string | null
          ghl_funnel_id?: string
          id?: string
          last_synced_at?: string
          location_id?: string
          name?: string
          page_count?: number | null
          raw_payload?: Json
          status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ghl_id_mapping: {
        Row: {
          created_at: string
          id: string
          match_confidence: string
          new_ghl_id: string | null
          notes: string | null
          old_ghl_id: string
          remapped_at: string | null
          resource_type: string
          source_account_label: string | null
          target_account_label: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_confidence?: string
          new_ghl_id?: string | null
          notes?: string | null
          old_ghl_id: string
          remapped_at?: string | null
          resource_type: string
          source_account_label?: string | null
          target_account_label?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          match_confidence?: string
          new_ghl_id?: string | null
          notes?: string | null
          old_ghl_id?: string
          remapped_at?: string | null
          resource_type?: string
          source_account_label?: string | null
          target_account_label?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ghl_marketing_dump_jobs: {
        Row: {
          account: string
          created_at: string
          created_by: string | null
          current_label: string | null
          cursor: Json
          download_assets: boolean
          error_log: Json
          failed_assets: number
          finished_at: string | null
          id: string
          processed_assets: number
          requested_resources: string[]
          started_at: string | null
          status: string
          total_assets: number
          updated_at: string
          use_firecrawl: boolean
        }
        Insert: {
          account?: string
          created_at?: string
          created_by?: string | null
          current_label?: string | null
          cursor?: Json
          download_assets?: boolean
          error_log?: Json
          failed_assets?: number
          finished_at?: string | null
          id?: string
          processed_assets?: number
          requested_resources?: string[]
          started_at?: string | null
          status?: string
          total_assets?: number
          updated_at?: string
          use_firecrawl?: boolean
        }
        Update: {
          account?: string
          created_at?: string
          created_by?: string | null
          current_label?: string | null
          cursor?: Json
          download_assets?: boolean
          error_log?: Json
          failed_assets?: number
          finished_at?: string | null
          id?: string
          processed_assets?: number
          requested_resources?: string[]
          started_at?: string | null
          status?: string
          total_assets?: number
          updated_at?: string
          use_firecrawl?: boolean
        }
        Relationships: []
      }
      ghl_marketing_raw_dumps: {
        Row: {
          asset_bytes: number
          asset_count: number
          asset_manifest: Json | null
          created_at: string
          css_content: string | null
          embed_code: string | null
          endpoints_tried: Json | null
          enrichment_sources: Json | null
          fetch_error: string | null
          fetch_status: string | null
          full_url: string | null
          ghl_id: string
          harvest_job_id: string | null
          html_content: string | null
          id: string
          inlined_css: string | null
          last_fetched_at: string
          links: Json | null
          location_id: string | null
          markdown_content: string | null
          metadata: Json | null
          name: string | null
          parent_ghl_id: string | null
          portable_html_path: string | null
          raw_html_content: string | null
          raw_payload: Json | null
          reconstruction_notes: string | null
          resource_type: string
          screenshot_url: string | null
          submissions_sample: Json | null
          updated_at: string
        }
        Insert: {
          asset_bytes?: number
          asset_count?: number
          asset_manifest?: Json | null
          created_at?: string
          css_content?: string | null
          embed_code?: string | null
          endpoints_tried?: Json | null
          enrichment_sources?: Json | null
          fetch_error?: string | null
          fetch_status?: string | null
          full_url?: string | null
          ghl_id: string
          harvest_job_id?: string | null
          html_content?: string | null
          id?: string
          inlined_css?: string | null
          last_fetched_at?: string
          links?: Json | null
          location_id?: string | null
          markdown_content?: string | null
          metadata?: Json | null
          name?: string | null
          parent_ghl_id?: string | null
          portable_html_path?: string | null
          raw_html_content?: string | null
          raw_payload?: Json | null
          reconstruction_notes?: string | null
          resource_type: string
          screenshot_url?: string | null
          submissions_sample?: Json | null
          updated_at?: string
        }
        Update: {
          asset_bytes?: number
          asset_count?: number
          asset_manifest?: Json | null
          created_at?: string
          css_content?: string | null
          embed_code?: string | null
          endpoints_tried?: Json | null
          enrichment_sources?: Json | null
          fetch_error?: string | null
          fetch_status?: string | null
          full_url?: string | null
          ghl_id?: string
          harvest_job_id?: string | null
          html_content?: string | null
          id?: string
          inlined_css?: string | null
          last_fetched_at?: string
          links?: Json | null
          location_id?: string | null
          markdown_content?: string | null
          metadata?: Json | null
          name?: string | null
          parent_ghl_id?: string | null
          portable_html_path?: string | null
          raw_html_content?: string | null
          raw_payload?: Json | null
          reconstruction_notes?: string | null
          resource_type?: string
          screenshot_url?: string | null
          submissions_sample?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghl_marketing_raw_dumps_harvest_job_id_fkey"
            columns: ["harvest_job_id"]
            isOneToOne: false
            referencedRelation: "ghl_marketing_dump_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_migration_baseline: {
        Row: {
          captured_at: string
          created_at: string
          id: string
          notes: string | null
          row_count: number
          snapshot_label: string
          table_name: string
        }
        Insert: {
          captured_at?: string
          created_at?: string
          id?: string
          notes?: string | null
          row_count: number
          snapshot_label: string
          table_name: string
        }
        Update: {
          captured_at?: string
          created_at?: string
          id?: string
          notes?: string | null
          row_count?: number
          snapshot_label?: string
          table_name?: string
        }
        Relationships: []
      }
      ghl_pipeline_stages: {
        Row: {
          color: string | null
          created_at: string
          ghl_id: string
          id: string
          name: string
          pipeline_id: string
          position: number | null
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          ghl_id: string
          id?: string
          name: string
          pipeline_id: string
          position?: number | null
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          ghl_id?: string
          id?: string
          name?: string
          pipeline_id?: string
          position?: number | null
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghl_pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "ghl_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_pipelines: {
        Row: {
          created_at: string
          ghl_id: string
          id: string
          is_active: boolean | null
          location_id: string | null
          name: string
          position: number | null
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          ghl_id: string
          id?: string
          is_active?: boolean | null
          location_id?: string | null
          name: string
          position?: number | null
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          ghl_id?: string
          id?: string
          is_active?: boolean | null
          location_id?: string | null
          name?: string
          position?: number | null
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ghl_rate_state: {
        Row: {
          cooldown_until_ms: number
          last_429_at: string | null
          token_key: string
          updated_at: string
          window_count: number
          window_start_ms: number
        }
        Insert: {
          cooldown_until_ms?: number
          last_429_at?: string | null
          token_key: string
          updated_at?: string
          window_count?: number
          window_start_ms?: number
        }
        Update: {
          cooldown_until_ms?: number
          last_429_at?: string | null
          token_key?: string
          updated_at?: string
          window_count?: number
          window_start_ms?: number
        }
        Relationships: []
      }
      ghl_workflow_snapshot_bridge: {
        Row: {
          created_at: string
          id: string
          legacy_name: string | null
          legacy_workflow_id: string
          new_workflow_id: string | null
          notes: string | null
          raw_metadata: Json | null
          status: string
          step_count: number | null
          trigger_summary: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          legacy_name?: string | null
          legacy_workflow_id: string
          new_workflow_id?: string | null
          notes?: string | null
          raw_metadata?: Json | null
          status?: string
          step_count?: number | null
          trigger_summary?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          legacy_name?: string | null
          legacy_workflow_id?: string
          new_workflow_id?: string | null
          notes?: string | null
          raw_metadata?: Json | null
          status?: string
          step_count?: number | null
          trigger_summary?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ghl_workflow_snapshots: {
        Row: {
          account: string
          created_at: string
          fetched_at: string
          first_seen_at: string
          id: string
          is_stale: boolean
          last_seen_at: string
          location_id: string | null
          name: string | null
          raw_json: Json
          rebuild_blueprint: Json | null
          rebuild_marked_done_at: string | null
          rebuild_marked_done_by: string | null
          rebuild_notes: string | null
          status: string | null
          updated_at: string
          version: number | null
          workflow_id: string
        }
        Insert: {
          account: string
          created_at?: string
          fetched_at?: string
          first_seen_at?: string
          id?: string
          is_stale?: boolean
          last_seen_at?: string
          location_id?: string | null
          name?: string | null
          raw_json?: Json
          rebuild_blueprint?: Json | null
          rebuild_marked_done_at?: string | null
          rebuild_marked_done_by?: string | null
          rebuild_notes?: string | null
          status?: string | null
          updated_at?: string
          version?: number | null
          workflow_id: string
        }
        Update: {
          account?: string
          created_at?: string
          fetched_at?: string
          first_seen_at?: string
          id?: string
          is_stale?: boolean
          last_seen_at?: string
          location_id?: string | null
          name?: string | null
          raw_json?: Json
          rebuild_blueprint?: Json | null
          rebuild_marked_done_at?: string | null
          rebuild_marked_done_by?: string | null
          rebuild_notes?: string | null
          status?: string | null
          updated_at?: string
          version?: number | null
          workflow_id?: string
        }
        Relationships: []
      }
      ghl_workflows: {
        Row: {
          created_at: string
          ghl_workflow_id: string
          id: string
          last_synced_at: string
          location_id: string
          name: string
          raw_payload: Json
          status: string | null
          step_count: number | null
          trigger_summary: string | null
          updated_at: string
          version: number | null
        }
        Insert: {
          created_at?: string
          ghl_workflow_id: string
          id?: string
          last_synced_at?: string
          location_id: string
          name: string
          raw_payload?: Json
          status?: string | null
          step_count?: number | null
          trigger_summary?: string | null
          updated_at?: string
          version?: number | null
        }
        Update: {
          created_at?: string
          ghl_workflow_id?: string
          id?: string
          last_synced_at?: string
          location_id?: string
          name?: string
          raw_payload?: Json
          status?: string | null
          step_count?: number | null
          trigger_summary?: string | null
          updated_at?: string
          version?: number | null
        }
        Relationships: []
      }
      global_report_settings: {
        Row: {
          created_at: string
          id: string
          setting_key: string
          setting_value: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          setting_key: string
          setting_value?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          setting_key?: string
          setting_value?: Json
          updated_at?: string
        }
        Relationships: []
      }
      hero_image_library: {
        Row: {
          aspect_ratio: string
          created_at: string
          enhanced_prompt: string | null
          error: string | null
          height: number
          id: string
          is_archived: boolean
          model: string
          owner_user_id: string
          prompt: string
          public_url: string | null
          source_report_id: string | null
          status: string
          storage_path: string | null
          tags: string[]
          thumbnail_url: string | null
          updated_at: string
          width: number
        }
        Insert: {
          aspect_ratio?: string
          created_at?: string
          enhanced_prompt?: string | null
          error?: string | null
          height?: number
          id?: string
          is_archived?: boolean
          model?: string
          owner_user_id: string
          prompt: string
          public_url?: string | null
          source_report_id?: string | null
          status?: string
          storage_path?: string | null
          tags?: string[]
          thumbnail_url?: string | null
          updated_at?: string
          width?: number
        }
        Update: {
          aspect_ratio?: string
          created_at?: string
          enhanced_prompt?: string | null
          error?: string | null
          height?: number
          id?: string
          is_archived?: boolean
          model?: string
          owner_user_id?: string
          prompt?: string
          public_url?: string | null
          source_report_id?: string | null
          status?: string
          storage_path?: string | null
          tags?: string[]
          thumbnail_url?: string | null
          updated_at?: string
          width?: number
        }
        Relationships: []
      }
      industrial_capex: {
        Row: {
          amount: number
          category: string
          created_at: string
          id: string
          notes: string | null
          property_id: string
          updated_at: string
          year: number
        }
        Insert: {
          amount?: number
          category?: string
          created_at?: string
          id?: string
          notes?: string | null
          property_id: string
          updated_at?: string
          year: number
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          id?: string
          notes?: string | null
          property_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "industrial_capex_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "industrial_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      industrial_financing: {
        Row: {
          created_at: string
          id: string
          interest_rate: number | null
          io_period_years: number | null
          lender: string | null
          loan_amount: number | null
          loan_balance: number | null
          loan_term_years: number | null
          lvr_pct: number | null
          notes: string | null
          ongoing_fees_pa: number | null
          property_id: string
          rate_type: string | null
          repayment_type: string | null
          updated_at: string
          upfront_fees: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          interest_rate?: number | null
          io_period_years?: number | null
          lender?: string | null
          loan_amount?: number | null
          loan_balance?: number | null
          loan_term_years?: number | null
          lvr_pct?: number | null
          notes?: string | null
          ongoing_fees_pa?: number | null
          property_id: string
          rate_type?: string | null
          repayment_type?: string | null
          updated_at?: string
          upfront_fees?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          interest_rate?: number | null
          io_period_years?: number | null
          lender?: string | null
          loan_amount?: number | null
          loan_balance?: number | null
          loan_term_years?: number | null
          lvr_pct?: number | null
          notes?: string | null
          ongoing_fees_pa?: number | null
          property_id?: string
          rate_type?: string | null
          repayment_type?: string | null
          updated_at?: string
          upfront_fees?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "industrial_financing_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "industrial_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      industrial_properties: {
        Row: {
          asset_subtype: string
          clearance_metres: number | null
          client_id: string | null
          condition_rating: string | null
          created_at: string
          current_valuation: number | null
          dock_doors: number | null
          gla_sqm: number | null
          ground_floor_load_kpa: number | null
          hardstand_sqm: number | null
          id: string
          industrial_financing: Json | null
          linked_at: string | null
          notes: string | null
          office_pct: number | null
          postcode: string | null
          power_kva: number | null
          property_name: string | null
          purchase_date: string | null
          purchase_price: number | null
          site_area_sqm: number | null
          site_cover_pct: number | null
          state: string | null
          status: string
          street: string | null
          suburb: string | null
          updated_at: string
          user_id: string
          valuation_date: string | null
          year_built: number | null
          zoning: string | null
        }
        Insert: {
          asset_subtype?: string
          clearance_metres?: number | null
          client_id?: string | null
          condition_rating?: string | null
          created_at?: string
          current_valuation?: number | null
          dock_doors?: number | null
          gla_sqm?: number | null
          ground_floor_load_kpa?: number | null
          hardstand_sqm?: number | null
          id?: string
          industrial_financing?: Json | null
          linked_at?: string | null
          notes?: string | null
          office_pct?: number | null
          postcode?: string | null
          power_kva?: number | null
          property_name?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          site_area_sqm?: number | null
          site_cover_pct?: number | null
          state?: string | null
          status?: string
          street?: string | null
          suburb?: string | null
          updated_at?: string
          user_id: string
          valuation_date?: string | null
          year_built?: number | null
          zoning?: string | null
        }
        Update: {
          asset_subtype?: string
          clearance_metres?: number | null
          client_id?: string | null
          condition_rating?: string | null
          created_at?: string
          current_valuation?: number | null
          dock_doors?: number | null
          gla_sqm?: number | null
          ground_floor_load_kpa?: number | null
          hardstand_sqm?: number | null
          id?: string
          industrial_financing?: Json | null
          linked_at?: string | null
          notes?: string | null
          office_pct?: number | null
          postcode?: string | null
          power_kva?: number | null
          property_name?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          site_area_sqm?: number | null
          site_cover_pct?: number | null
          state?: string | null
          status?: string
          street?: string | null
          suburb?: string | null
          updated_at?: string
          user_id?: string
          valuation_date?: string | null
          year_built?: number | null
          zoning?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "industrial_properties_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      industrial_tenancies: {
        Row: {
          annual_review_type: string
          anzsic_industry: string | null
          bank_guarantee_months: number | null
          base_rent_pa: number | null
          base_rent_per_sqm_pa: number | null
          created_at: string
          gla_sqm: number | null
          id: string
          incentive_pct: number | null
          lease_end: string | null
          lease_start: string | null
          make_good_status: string | null
          notes: string | null
          option_terms_years: number | null
          outgoings_recovery_type: string
          property_id: string
          review_rate_pct: number | null
          tenant_name: string
          unit_label: string | null
          updated_at: string
        }
        Insert: {
          annual_review_type?: string
          anzsic_industry?: string | null
          bank_guarantee_months?: number | null
          base_rent_pa?: number | null
          base_rent_per_sqm_pa?: number | null
          created_at?: string
          gla_sqm?: number | null
          id?: string
          incentive_pct?: number | null
          lease_end?: string | null
          lease_start?: string | null
          make_good_status?: string | null
          notes?: string | null
          option_terms_years?: number | null
          outgoings_recovery_type?: string
          property_id: string
          review_rate_pct?: number | null
          tenant_name: string
          unit_label?: string | null
          updated_at?: string
        }
        Update: {
          annual_review_type?: string
          anzsic_industry?: string | null
          bank_guarantee_months?: number | null
          base_rent_pa?: number | null
          base_rent_per_sqm_pa?: number | null
          created_at?: string
          gla_sqm?: number | null
          id?: string
          incentive_pct?: number | null
          lease_end?: string | null
          lease_start?: string | null
          make_good_status?: string | null
          notes?: string | null
          option_terms_years?: number | null
          outgoings_recovery_type?: string
          property_id?: string
          review_rate_pct?: number | null
          tenant_name?: string
          unit_label?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "industrial_tenancies_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "industrial_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_configs: {
        Row: {
          created_at: string
          id: string
          integration_id: string
          key_name: string
          key_value: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          integration_id: string
          key_name: string
          key_value?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          integration_id?: string
          key_name?: string
          key_value?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      internal_request_nonces: {
        Row: {
          caller_function: string | null
          nonce: string
          seen_at: string
        }
        Insert: {
          caller_function?: string | null
          nonce: string
          seen_at?: string
        }
        Update: {
          caller_function?: string | null
          nonce?: string
          seen_at?: string
        }
        Relationships: []
      }
      investment_reports: {
        Row: {
          bulk_job_id: string | null
          calculation_version: string | null
          client_property_id: string | null
          created_at: string
          current_version: number | null
          data_sources: Json | null
          demographics_data: Json | null
          derived_from_report_id: string | null
          economic_data: Json | null
          error_message: string | null
          financial_calculations: Json | null
          generated_by: string | null
          generation_engine: string
          id: string
          investment_score: Json | null
          is_archived: boolean
          is_client_report: boolean | null
          last_completed_section: number | null
          location_intelligence: Json | null
          manual_overrides: Json | null
          parent_report_id: string | null
          pdf_url: string | null
          property_address: string
          property_listing_id: string | null
          property_specs: Json | null
          report_content: string
          report_scope: string | null
          report_tier: string
          report_variant: string
          sources_content: string | null
          status: string
          total_sections: number | null
          updated_at: string
          validation_flags: Json | null
          variant_generated_at: string | null
        }
        Insert: {
          bulk_job_id?: string | null
          calculation_version?: string | null
          client_property_id?: string | null
          created_at?: string
          current_version?: number | null
          data_sources?: Json | null
          demographics_data?: Json | null
          derived_from_report_id?: string | null
          economic_data?: Json | null
          error_message?: string | null
          financial_calculations?: Json | null
          generated_by?: string | null
          generation_engine?: string
          id?: string
          investment_score?: Json | null
          is_archived?: boolean
          is_client_report?: boolean | null
          last_completed_section?: number | null
          location_intelligence?: Json | null
          manual_overrides?: Json | null
          parent_report_id?: string | null
          pdf_url?: string | null
          property_address: string
          property_listing_id?: string | null
          property_specs?: Json | null
          report_content: string
          report_scope?: string | null
          report_tier?: string
          report_variant?: string
          sources_content?: string | null
          status?: string
          total_sections?: number | null
          updated_at?: string
          validation_flags?: Json | null
          variant_generated_at?: string | null
        }
        Update: {
          bulk_job_id?: string | null
          calculation_version?: string | null
          client_property_id?: string | null
          created_at?: string
          current_version?: number | null
          data_sources?: Json | null
          demographics_data?: Json | null
          derived_from_report_id?: string | null
          economic_data?: Json | null
          error_message?: string | null
          financial_calculations?: Json | null
          generated_by?: string | null
          generation_engine?: string
          id?: string
          investment_score?: Json | null
          is_archived?: boolean
          is_client_report?: boolean | null
          last_completed_section?: number | null
          location_intelligence?: Json | null
          manual_overrides?: Json | null
          parent_report_id?: string | null
          pdf_url?: string | null
          property_address?: string
          property_listing_id?: string | null
          property_specs?: Json | null
          report_content?: string
          report_scope?: string | null
          report_tier?: string
          report_variant?: string
          sources_content?: string | null
          status?: string
          total_sections?: number | null
          updated_at?: string
          validation_flags?: Json | null
          variant_generated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investment_reports_client_property_id_fkey"
            columns: ["client_property_id"]
            isOneToOne: false
            referencedRelation: "client_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_reports_derived_from_report_id_fkey"
            columns: ["derived_from_report_id"]
            isOneToOne: false
            referencedRelation: "investment_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_reports_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_reports_parent_report_id_fkey"
            columns: ["parent_report_id"]
            isOneToOne: false
            referencedRelation: "investment_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      land_tax_addons: {
        Row: {
          addon_name: string
          applies_when: string
          created_at: string
          id: string
          notes: string | null
          rate: number
          state: string
          threshold: number
        }
        Insert: {
          addon_name: string
          applies_when: string
          created_at?: string
          id?: string
          notes?: string | null
          rate?: number
          state: string
          threshold?: number
        }
        Update: {
          addon_name?: string
          applies_when?: string
          created_at?: string
          id?: string
          notes?: string | null
          rate?: number
          state?: string
          threshold?: number
        }
        Relationships: []
      }
      land_tax_quarterly_splits: {
        Row: {
          created_at: string
          id: string
          leap_year_pct: number
          non_leap_year_pct: number
          quarter: string
        }
        Insert: {
          created_at?: string
          id?: string
          leap_year_pct: number
          non_leap_year_pct: number
          quarter: string
        }
        Update: {
          created_at?: string
          id?: string
          leap_year_pct?: number
          non_leap_year_pct?: number
          quarter?: string
        }
        Relationships: []
      }
      land_tax_rates: {
        Row: {
          base_tax: number
          created_at: string
          effective_year: number
          fixed_charge: number
          id: string
          lower_bound: number
          marginal_rate: number
          marginal_threshold: number
          notes: string | null
          owner_type: string
          state: string
          updated_at: string
          upper_bound: number
        }
        Insert: {
          base_tax?: number
          created_at?: string
          effective_year?: number
          fixed_charge?: number
          id?: string
          lower_bound?: number
          marginal_rate?: number
          marginal_threshold?: number
          notes?: string | null
          owner_type: string
          state: string
          updated_at?: string
          upper_bound?: number
        }
        Update: {
          base_tax?: number
          created_at?: string
          effective_year?: number
          fixed_charge?: number
          id?: string
          lower_bound?: number
          marginal_rate?: number
          marginal_threshold?: number
          notes?: string | null
          owner_type?: string
          state?: string
          updated_at?: string
          upper_bound?: number
        }
        Relationships: []
      }
      lead_magnet_downloads: {
        Row: {
          created_at: string
          email: string
          full_name: string
          ghl_contact_id: string | null
          ghl_error: string | null
          ghl_synced: boolean
          id: string
          ip_address: string | null
          magnet_id: string
          phone: string | null
          referrer: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          ghl_contact_id?: string | null
          ghl_error?: string | null
          ghl_synced?: boolean
          id?: string
          ip_address?: string | null
          magnet_id: string
          phone?: string | null
          referrer?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          ghl_contact_id?: string | null
          ghl_error?: string | null
          ghl_synced?: boolean
          id?: string
          ip_address?: string | null
          magnet_id?: string
          phone?: string | null
          referrer?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_magnet_downloads_magnet_id_fkey"
            columns: ["magnet_id"]
            isOneToOne: false
            referencedRelation: "lead_magnets"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_magnet_versions: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          magnet_id: string
          mime_type: string | null
          notes: string | null
          uploaded_by: string | null
          version_number: number
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          magnet_id: string
          mime_type?: string | null
          notes?: string | null
          uploaded_by?: string | null
          version_number: number
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          magnet_id?: string
          mime_type?: string | null
          notes?: string | null
          uploaded_by?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_magnet_versions_magnet_id_fkey"
            columns: ["magnet_id"]
            isOneToOne: false
            referencedRelation: "lead_magnets"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_magnets: {
        Row: {
          active_version_id: string | null
          created_at: string
          description: string | null
          download_count: number
          file_name: string
          file_path: string
          file_size: number | null
          ghl_pipeline_id: string | null
          ghl_stage_id: string | null
          ghl_tag: string | null
          id: string
          is_active: boolean
          mime_type: string | null
          slug: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          active_version_id?: string | null
          created_at?: string
          description?: string | null
          download_count?: number
          file_name: string
          file_path: string
          file_size?: number | null
          ghl_pipeline_id?: string | null
          ghl_stage_id?: string | null
          ghl_tag?: string | null
          id?: string
          is_active?: boolean
          mime_type?: string | null
          slug: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          active_version_id?: string | null
          created_at?: string
          description?: string | null
          download_count?: number
          file_name?: string
          file_path?: string
          file_size?: number | null
          ghl_pipeline_id?: string | null
          ghl_stage_id?: string | null
          ghl_tag?: string | null
          id?: string
          is_active?: boolean
          mime_type?: string | null
          slug?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_magnets_active_version_id_fkey"
            columns: ["active_version_id"]
            isOneToOne: false
            referencedRelation: "lead_magnet_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_source_attributions: {
        Row: {
          attributed_at: string
          client_id: string
          conversion_page_url: string | null
          created_at: string
          deal_id: string | null
          device_type: string | null
          enriched_at: string | null
          enrichment_status: string | null
          fbclid: string | null
          gclid: string | null
          geo_location: string | null
          ghl_attribution_source: string | null
          ghl_contact_id: string | null
          ghl_last_attribution_source: string | null
          id: string
          landing_page_url: string | null
          meta_ad_creative_url: string | null
          meta_ad_id: string | null
          meta_ad_name: string | null
          meta_adset_id: string | null
          meta_adset_name: string | null
          meta_campaign_id: string | null
          meta_campaign_name: string | null
          meta_campaign_objective: string | null
          notes: string | null
          referrer_url: string | null
          source_type: Database["public"]["Enums"]["attribution_source_type"]
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          attributed_at?: string
          client_id: string
          conversion_page_url?: string | null
          created_at?: string
          deal_id?: string | null
          device_type?: string | null
          enriched_at?: string | null
          enrichment_status?: string | null
          fbclid?: string | null
          gclid?: string | null
          geo_location?: string | null
          ghl_attribution_source?: string | null
          ghl_contact_id?: string | null
          ghl_last_attribution_source?: string | null
          id?: string
          landing_page_url?: string | null
          meta_ad_creative_url?: string | null
          meta_ad_id?: string | null
          meta_ad_name?: string | null
          meta_adset_id?: string | null
          meta_adset_name?: string | null
          meta_campaign_id?: string | null
          meta_campaign_name?: string | null
          meta_campaign_objective?: string | null
          notes?: string | null
          referrer_url?: string | null
          source_type?: Database["public"]["Enums"]["attribution_source_type"]
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          attributed_at?: string
          client_id?: string
          conversion_page_url?: string | null
          created_at?: string
          deal_id?: string | null
          device_type?: string | null
          enriched_at?: string | null
          enrichment_status?: string | null
          fbclid?: string | null
          gclid?: string | null
          geo_location?: string | null
          ghl_attribution_source?: string | null
          ghl_contact_id?: string | null
          ghl_last_attribution_source?: string | null
          id?: string
          landing_page_url?: string | null
          meta_ad_creative_url?: string | null
          meta_ad_id?: string | null
          meta_ad_name?: string | null
          meta_adset_id?: string | null
          meta_adset_name?: string | null
          meta_campaign_id?: string | null
          meta_campaign_name?: string | null
          meta_campaign_objective?: string | null
          notes?: string | null
          referrer_url?: string | null
          source_type?: Database["public"]["Enums"]["attribution_source_type"]
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_source_attributions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_source_attributions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "client_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_source_attributions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["client_deal_id"]
          },
        ]
      }
      legacy_wipe_jobs: {
        Row: {
          completed_at: string | null
          confirmation_received: string | null
          created_at: string
          created_by: string | null
          current_resource: string | null
          cutover_finalised: boolean
          dispatch_count: number
          dry_run: boolean
          id: string
          last_error: string | null
          progress: Json
          resources_completed: string[]
          started_at: string | null
          status: string
          total_deleted: number
          total_failed: number
          updated_at: string
          worker_lock_until: string | null
        }
        Insert: {
          completed_at?: string | null
          confirmation_received?: string | null
          created_at?: string
          created_by?: string | null
          current_resource?: string | null
          cutover_finalised?: boolean
          dispatch_count?: number
          dry_run?: boolean
          id?: string
          last_error?: string | null
          progress?: Json
          resources_completed?: string[]
          started_at?: string | null
          status?: string
          total_deleted?: number
          total_failed?: number
          updated_at?: string
          worker_lock_until?: string | null
        }
        Update: {
          completed_at?: string | null
          confirmation_received?: string | null
          created_at?: string
          created_by?: string | null
          current_resource?: string | null
          cutover_finalised?: boolean
          dispatch_count?: number
          dry_run?: boolean
          id?: string
          last_error?: string | null
          progress?: Json
          resources_completed?: string[]
          started_at?: string | null
          status?: string
          total_deleted?: number
          total_failed?: number
          updated_at?: string
          worker_lock_until?: string | null
        }
        Relationships: []
      }
      lender_comparison_sheets: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          deal_id: string | null
          filters: Json | null
          id: string
          lender_ids: string[]
          name: string
          notes: string | null
          pdf_storage_path: string | null
          rate_snapshot: Json
          shared_with_client: boolean
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          filters?: Json | null
          id?: string
          lender_ids?: string[]
          name: string
          notes?: string | null
          pdf_storage_path?: string | null
          rate_snapshot?: Json
          shared_with_client?: boolean
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          filters?: Json | null
          id?: string
          lender_ids?: string[]
          name?: string
          notes?: string | null
          pdf_storage_path?: string | null
          rate_snapshot?: Json
          shared_with_client?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lender_comparison_sheets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lender_comparison_sheets_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "client_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lender_comparison_sheets_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["client_deal_id"]
          },
        ]
      }
      lender_favourites: {
        Row: {
          created_at: string
          display_order: number
          id: string
          lender_id: string
          lender_name: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          lender_id: string
          lender_name: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          lender_id?: string
          lender_name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lender_playbooks: {
        Row: {
          bdm_email: string | null
          bdm_name: string | null
          bdm_phone: string | null
          created_at: string
          document_rules: string | null
          id: string
          is_active: boolean
          lender_key: string
          lender_label: string
          quirks: string | null
          rate_band_pa: number | null
          rate_notes: string | null
          typical_turnaround_days_override: number | null
          updated_at: string
          updated_by_finance_user_id: string | null
        }
        Insert: {
          bdm_email?: string | null
          bdm_name?: string | null
          bdm_phone?: string | null
          created_at?: string
          document_rules?: string | null
          id?: string
          is_active?: boolean
          lender_key: string
          lender_label: string
          quirks?: string | null
          rate_band_pa?: number | null
          rate_notes?: string | null
          typical_turnaround_days_override?: number | null
          updated_at?: string
          updated_by_finance_user_id?: string | null
        }
        Update: {
          bdm_email?: string | null
          bdm_name?: string | null
          bdm_phone?: string | null
          created_at?: string
          document_rules?: string | null
          id?: string
          is_active?: boolean
          lender_key?: string
          lender_label?: string
          quirks?: string | null
          rate_band_pa?: number | null
          rate_notes?: string | null
          typical_turnaround_days_override?: number | null
          updated_at?: string
          updated_by_finance_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lender_playbooks_updated_by_finance_user_id_fkey"
            columns: ["updated_by_finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      lender_rate_alerts: {
        Row: {
          created_at: string
          id: string
          is_enabled: boolean
          last_triggered_at: string | null
          last_triggered_rate: number | null
          lender_id: string
          lender_name: string
          loan_purpose:
            | Database["public"]["Enums"]["lender_loan_purpose"]
            | null
          lvr_max: number | null
          repayment_type:
            | Database["public"]["Enums"]["lender_repayment_type"]
            | null
          threshold_rate: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          last_triggered_at?: string | null
          last_triggered_rate?: number | null
          lender_id: string
          lender_name: string
          loan_purpose?:
            | Database["public"]["Enums"]["lender_loan_purpose"]
            | null
          lvr_max?: number | null
          repayment_type?:
            | Database["public"]["Enums"]["lender_repayment_type"]
            | null
          threshold_rate: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          last_triggered_at?: string | null
          last_triggered_rate?: number | null
          lender_id?: string
          lender_name?: string
          loan_purpose?:
            | Database["public"]["Enums"]["lender_loan_purpose"]
            | null
          lvr_max?: number | null
          repayment_type?:
            | Database["public"]["Enums"]["lender_repayment_type"]
            | null
          threshold_rate?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lender_rate_cards: {
        Row: {
          comparison_rate: number | null
          created_at: string
          effective_from: string
          effective_to: string | null
          fixed_term_months: number | null
          id: string
          is_active: boolean
          lender_key: string
          lmi_waiver_at_lvr: number | null
          loan_purpose: string
          max_loan: number | null
          max_lvr: number
          metadata: Json
          min_loan: number | null
          notes: string | null
          offset_available: boolean
          ongoing_fees_annual: number
          product_name: string
          rate_pa: number
          redraw_available: boolean
          repayment_type: string
          updated_at: string
          upfront_fees: number
        }
        Insert: {
          comparison_rate?: number | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          fixed_term_months?: number | null
          id?: string
          is_active?: boolean
          lender_key: string
          lmi_waiver_at_lvr?: number | null
          loan_purpose?: string
          max_loan?: number | null
          max_lvr?: number
          metadata?: Json
          min_loan?: number | null
          notes?: string | null
          offset_available?: boolean
          ongoing_fees_annual?: number
          product_name: string
          rate_pa: number
          redraw_available?: boolean
          repayment_type?: string
          updated_at?: string
          upfront_fees?: number
        }
        Update: {
          comparison_rate?: number | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          fixed_term_months?: number | null
          id?: string
          is_active?: boolean
          lender_key?: string
          lmi_waiver_at_lvr?: number | null
          loan_purpose?: string
          max_loan?: number | null
          max_lvr?: number
          metadata?: Json
          min_loan?: number | null
          notes?: string | null
          offset_available?: boolean
          ongoing_fees_annual?: number
          product_name?: string
          rate_pa?: number
          redraw_available?: boolean
          repayment_type?: string
          updated_at?: string
          upfront_fees?: number
        }
        Relationships: []
      }
      lender_submission_documents: {
        Row: {
          created_at: string
          display_order: number
          doc_name: string
          doc_type: string
          file_size: number | null
          id: string
          mime_type: string | null
          notes: string | null
          status: Database["public"]["Enums"]["lender_doc_status"]
          storage_path: string | null
          submission_id: string
          updated_at: string
          uploaded_at: string | null
          uploaded_by: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string
          display_order?: number
          doc_name: string
          doc_type: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["lender_doc_status"]
          storage_path?: string | null
          submission_id: string
          updated_at?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string
          display_order?: number
          doc_name?: string
          doc_type?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["lender_doc_status"]
          storage_path?: string | null
          submission_id?: string
          updated_at?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lender_submission_documents_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "lender_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      lender_submission_timeline: {
        Row: {
          actor_id: string | null
          created_at: string
          event_label: string
          event_type: string
          id: string
          payload: Json | null
          submission_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_label: string
          event_type: string
          id?: string
          payload?: Json | null
          submission_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_label?: string
          event_type?: string
          id?: string
          payload?: Json | null
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lender_submission_timeline_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "lender_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      lender_submissions: {
        Row: {
          approved_at: string | null
          assessed_at: string | null
          assigned_broker_id: string | null
          client_id: string
          comparison_rate: number | null
          created_at: string
          created_by: string | null
          deal_id: string | null
          decline_reason: string | null
          external_reference: string | null
          finance_user_id: string | null
          ghl_pipeline_stage_id: string | null
          id: string
          interest_rate: number | null
          is_preferred_pathway: boolean
          lender_id: string
          lender_name: string
          loan_amount: number | null
          loan_purpose:
            | Database["public"]["Enums"]["lender_loan_purpose"]
            | null
          loan_term_years: number | null
          lvr: number | null
          notes: string | null
          product_name: string | null
          purchase_file_id: string | null
          repayment_type:
            | Database["public"]["Enums"]["lender_repayment_type"]
            | null
          settled_at: string | null
          status: Database["public"]["Enums"]["lender_submission_status"]
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          assessed_at?: string | null
          assigned_broker_id?: string | null
          client_id: string
          comparison_rate?: number | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          decline_reason?: string | null
          external_reference?: string | null
          finance_user_id?: string | null
          ghl_pipeline_stage_id?: string | null
          id?: string
          interest_rate?: number | null
          is_preferred_pathway?: boolean
          lender_id: string
          lender_name: string
          loan_amount?: number | null
          loan_purpose?:
            | Database["public"]["Enums"]["lender_loan_purpose"]
            | null
          loan_term_years?: number | null
          lvr?: number | null
          notes?: string | null
          product_name?: string | null
          purchase_file_id?: string | null
          repayment_type?:
            | Database["public"]["Enums"]["lender_repayment_type"]
            | null
          settled_at?: string | null
          status?: Database["public"]["Enums"]["lender_submission_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          assessed_at?: string | null
          assigned_broker_id?: string | null
          client_id?: string
          comparison_rate?: number | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          decline_reason?: string | null
          external_reference?: string | null
          finance_user_id?: string | null
          ghl_pipeline_stage_id?: string | null
          id?: string
          interest_rate?: number | null
          is_preferred_pathway?: boolean
          lender_id?: string
          lender_name?: string
          loan_amount?: number | null
          loan_purpose?:
            | Database["public"]["Enums"]["lender_loan_purpose"]
            | null
          loan_term_years?: number | null
          lvr?: number | null
          notes?: string | null
          product_name?: string | null
          purchase_file_id?: string | null
          repayment_type?:
            | Database["public"]["Enums"]["lender_repayment_type"]
            | null
          settled_at?: string | null
          status?: Database["public"]["Enums"]["lender_submission_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lender_submissions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lender_submissions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "client_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lender_submissions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["client_deal_id"]
          },
          {
            foreignKeyName: "lender_submissions_finance_user_id_fkey"
            columns: ["finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lender_submissions_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lender_submissions_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      llm_integration_settings: {
        Row: {
          created_at: string
          id: string
          is_enabled: boolean
          last_test_at: string | null
          last_test_error: string | null
          last_test_success: boolean | null
          metadata: Json | null
          monthly_spend_cap_usd: number | null
          provider: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_success?: boolean | null
          metadata?: Json | null
          monthly_spend_cap_usd?: number | null
          provider: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_success?: boolean | null
          metadata?: Json | null
          monthly_spend_cap_usd?: number | null
          provider?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      market_digests: {
        Row: {
          broker_adviser_implications: string | null
          buyer_implications: string | null
          client_advisory_implications: Json
          confidence_score: number | null
          construction_supply_highlights: Json
          created_at: string
          executive_summary: string
          finance_lending_highlights: Json
          generated_at: string
          id: string
          investor_implications: string | null
          period: string
          period_end: string
          period_start: string
          policy_regulation_highlights: Json
          political_economic_watchpoints: Json
          property_market_highlights: Json
          recommended_watchlist_for_tomorrow: Json
          segment_breakdown: Json
          social_watchpoints: Json
          source_urls: Json
          status: string
          top_update_ids: Json
          updated_at: string
        }
        Insert: {
          broker_adviser_implications?: string | null
          buyer_implications?: string | null
          client_advisory_implications?: Json
          confidence_score?: number | null
          construction_supply_highlights?: Json
          created_at?: string
          executive_summary: string
          finance_lending_highlights?: Json
          generated_at?: string
          id?: string
          investor_implications?: string | null
          period?: string
          period_end: string
          period_start: string
          policy_regulation_highlights?: Json
          political_economic_watchpoints?: Json
          property_market_highlights?: Json
          recommended_watchlist_for_tomorrow?: Json
          segment_breakdown?: Json
          social_watchpoints?: Json
          source_urls?: Json
          status?: string
          top_update_ids?: Json
          updated_at?: string
        }
        Update: {
          broker_adviser_implications?: string | null
          buyer_implications?: string | null
          client_advisory_implications?: Json
          confidence_score?: number | null
          construction_supply_highlights?: Json
          created_at?: string
          executive_summary?: string
          finance_lending_highlights?: Json
          generated_at?: string
          id?: string
          investor_implications?: string | null
          period?: string
          period_end?: string
          period_start?: string
          policy_regulation_highlights?: Json
          political_economic_watchpoints?: Json
          property_market_highlights?: Json
          recommended_watchlist_for_tomorrow?: Json
          segment_breakdown?: Json
          social_watchpoints?: Json
          source_urls?: Json
          status?: string
          top_update_ids?: Json
          updated_at?: string
        }
        Relationships: []
      }
      market_qa_digests: {
        Row: {
          cadence: string
          created_at: string
          delivery_channels: string[]
          digest_group: string | null
          id: string
          metadata: Json
          question_ids: string[]
          sent_at: string
          summary_md: string
          user_id: string
        }
        Insert: {
          cadence: string
          created_at?: string
          delivery_channels?: string[]
          digest_group?: string | null
          id?: string
          metadata?: Json
          question_ids?: string[]
          sent_at?: string
          summary_md: string
          user_id: string
        }
        Update: {
          cadence?: string
          created_at?: string
          delivery_channels?: string[]
          digest_group?: string | null
          id?: string
          metadata?: Json
          question_ids?: string[]
          sent_at?: string
          summary_md?: string
          user_id?: string
        }
        Relationships: []
      }
      market_qa_quality_baselines: {
        Row: {
          avg_confidence: number | null
          avg_retrieved_ids: number | null
          avg_used_ids: number | null
          created_at: string
          id: string
          low_confidence_count: number
          model_mix: Json
          refusal_count: number
          refusal_rate: number
          snapshot_date: string
          total_questions: number
        }
        Insert: {
          avg_confidence?: number | null
          avg_retrieved_ids?: number | null
          avg_used_ids?: number | null
          created_at?: string
          id?: string
          low_confidence_count?: number
          model_mix?: Json
          refusal_count?: number
          refusal_rate?: number
          snapshot_date: string
          total_questions?: number
        }
        Update: {
          avg_confidence?: number | null
          avg_retrieved_ids?: number | null
          avg_used_ids?: number | null
          created_at?: string
          id?: string
          low_confidence_count?: number
          model_mix?: Json
          refusal_count?: number
          refusal_rate?: number
          snapshot_date?: string
          total_questions?: number
        }
        Relationships: []
      }
      market_qa_quality_daily: {
        Row: {
          avg_citations: number | null
          created_at: string
          fallback_count: number
          hybrid_count: number
          hybrid_win_rate: number | null
          id: string
          lexical_count: number
          p50_latency_ms: number | null
          p95_latency_ms: number | null
          snapshot_date: string
          total_questions: number
          vector_count: number
        }
        Insert: {
          avg_citations?: number | null
          created_at?: string
          fallback_count?: number
          hybrid_count?: number
          hybrid_win_rate?: number | null
          id?: string
          lexical_count?: number
          p50_latency_ms?: number | null
          p95_latency_ms?: number | null
          snapshot_date: string
          total_questions?: number
          vector_count?: number
        }
        Update: {
          avg_citations?: number | null
          created_at?: string
          fallback_count?: number
          hybrid_count?: number
          hybrid_win_rate?: number | null
          id?: string
          lexical_count?: number
          p50_latency_ms?: number | null
          p95_latency_ms?: number | null
          snapshot_date?: string
          total_questions?: number
          vector_count?: number
        }
        Relationships: []
      }
      market_qa_subscription_runs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          question_id: string | null
          status: string
          subscription_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          question_id?: string | null
          status?: string
          subscription_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          question_id?: string | null
          status?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_qa_subscription_runs_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "market_update_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_qa_subscription_runs_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "market_qa_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      market_qa_subscriptions: {
        Row: {
          cadence: string
          channels: string[]
          created_at: string
          digest_group: string | null
          id: string
          is_active: boolean
          last_run_at: string | null
          next_run_at: string
          question_template: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cadence?: string
          channels?: string[]
          created_at?: string
          digest_group?: string | null
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          next_run_at?: string
          question_template: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cadence?: string
          channels?: string[]
          created_at?: string
          digest_group?: string | null
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          next_run_at?: string
          question_template?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      market_sources: {
        Row: {
          category: string
          created_at: string
          description: string | null
          enabled: boolean
          geography: string
          id: string
          last_error: string | null
          last_fetched_at: string | null
          last_success_at: string | null
          name: string
          refresh_frequency_hours: number
          reliability_tier: string
          source_type: string
          updated_at: string
          url: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          geography?: string
          id?: string
          last_error?: string | null
          last_fetched_at?: string | null
          last_success_at?: string | null
          name: string
          refresh_frequency_hours?: number
          reliability_tier?: string
          source_type: string
          updated_at?: string
          url: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          geography?: string
          id?: string
          last_error?: string | null
          last_fetched_at?: string | null
          last_success_at?: string | null
          name?: string
          refresh_frequency_hours?: number
          reliability_tier?: string
          source_type?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      market_update_qa_shares: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          is_revoked: boolean
          last_viewed_at: string | null
          question_id: string
          slug: string
          updated_at: string
          view_count: number
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          is_revoked?: boolean
          last_viewed_at?: string | null
          question_id: string
          slug: string
          updated_at?: string
          view_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          is_revoked?: boolean
          last_viewed_at?: string | null
          question_id?: string
          slug?: string
          updated_at?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "market_update_qa_shares_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "market_update_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      market_update_questions: {
        Row: {
          answer: string
          citation_urls: Json
          confidence_score: number | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          follow_up_questions: Json
          id: string
          key_figures: Json
          metadata: Json
          model_used: string | null
          question: string
          sentiment: string | null
          source_update_ids: Json
          time_horizon: string | null
        }
        Insert: {
          answer: string
          citation_urls?: Json
          confidence_score?: number | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          follow_up_questions?: Json
          id?: string
          key_figures?: Json
          metadata?: Json
          model_used?: string | null
          question: string
          sentiment?: string | null
          source_update_ids?: Json
          time_horizon?: string | null
        }
        Update: {
          answer?: string
          citation_urls?: Json
          confidence_score?: number | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          follow_up_questions?: Json
          id?: string
          key_figures?: Json
          metadata?: Json
          model_used?: string | null
          question?: string
          sentiment?: string | null
          source_update_ids?: Json
          time_horizon?: string | null
        }
        Relationships: []
      }
      market_updates: {
        Row: {
          ai_summary: string | null
          audience_tags: Json
          category: string
          citation_urls: Json
          confidence_score: number | null
          created_at: string
          dedupe_hash: string
          embedding: string | null
          embedding_generated_at: string | null
          failure_reason: string | null
          finance_implications: string | null
          freshness_tier: string | null
          geography: Json
          id: string
          impact_level: string
          ingested_at: string
          key_points: Json
          policy_implications: string | null
          property_implications: string | null
          raw_content_hash: string | null
          raw_excerpt: string | null
          relevance_score: number
          risk_flags: Json
          search_tsv: unknown
          segments: Json
          slug: string | null
          source_id: string | null
          source_name: string
          source_published_at: string | null
          source_url: string
          status: string
          title: string
          updated_at: string
          why_it_matters: string | null
        }
        Insert: {
          ai_summary?: string | null
          audience_tags?: Json
          category: string
          citation_urls?: Json
          confidence_score?: number | null
          created_at?: string
          dedupe_hash: string
          embedding?: string | null
          embedding_generated_at?: string | null
          failure_reason?: string | null
          finance_implications?: string | null
          freshness_tier?: string | null
          geography?: Json
          id?: string
          impact_level?: string
          ingested_at?: string
          key_points?: Json
          policy_implications?: string | null
          property_implications?: string | null
          raw_content_hash?: string | null
          raw_excerpt?: string | null
          relevance_score?: number
          risk_flags?: Json
          search_tsv?: unknown
          segments?: Json
          slug?: string | null
          source_id?: string | null
          source_name: string
          source_published_at?: string | null
          source_url: string
          status?: string
          title: string
          updated_at?: string
          why_it_matters?: string | null
        }
        Update: {
          ai_summary?: string | null
          audience_tags?: Json
          category?: string
          citation_urls?: Json
          confidence_score?: number | null
          created_at?: string
          dedupe_hash?: string
          embedding?: string | null
          embedding_generated_at?: string | null
          failure_reason?: string | null
          finance_implications?: string | null
          freshness_tier?: string | null
          geography?: Json
          id?: string
          impact_level?: string
          ingested_at?: string
          key_points?: Json
          policy_implications?: string | null
          property_implications?: string | null
          raw_content_hash?: string | null
          raw_excerpt?: string | null
          relevance_score?: number
          risk_flags?: Json
          search_tsv?: unknown
          segments?: Json
          slug?: string | null
          source_id?: string | null
          source_name?: string
          source_published_at?: string | null
          source_url?: string
          status?: string
          title?: string
          updated_at?: string
          why_it_matters?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "market_updates_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "market_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_intelligence_reports: {
        Row: {
          audience_segment: string
          created_at: string
          error_message: string | null
          generated_at: string
          generated_by: string
          id: string
          include_advisory_strategy: boolean
          include_npc_strategy: boolean
          pdf_storage_path: string | null
          report_data: Json | null
          report_period: string | null
          report_type: string
          status: string
          updated_at: string
        }
        Insert: {
          audience_segment?: string
          created_at?: string
          error_message?: string | null
          generated_at?: string
          generated_by: string
          id?: string
          include_advisory_strategy?: boolean
          include_npc_strategy?: boolean
          pdf_storage_path?: string | null
          report_data?: Json | null
          report_period?: string | null
          report_type?: string
          status?: string
          updated_at?: string
        }
        Update: {
          audience_segment?: string
          created_at?: string
          error_message?: string | null
          generated_at?: string
          generated_by?: string
          id?: string
          include_advisory_strategy?: boolean
          include_npc_strategy?: boolean
          pdf_storage_path?: string | null
          report_data?: Json | null
          report_period?: string | null
          report_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_intelligence_reports_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_report_distribution_log: {
        Row: {
          created_at: string
          error_message: string | null
          ghl_contact_id: string | null
          id: string
          recipient_email: string
          recipient_name: string | null
          report_id: string | null
          schedule_id: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          ghl_contact_id?: string | null
          id?: string
          recipient_email: string
          recipient_name?: string | null
          report_id?: string | null
          schedule_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          ghl_contact_id?: string | null
          id?: string
          recipient_email?: string
          recipient_name?: string | null
          report_id?: string | null
          schedule_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_report_distribution_log_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "marketing_intelligence_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_report_distribution_log_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "marketing_report_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_report_schedules: {
        Row: {
          audience_segment: string
          content_rotation_enabled: boolean
          created_at: string
          created_by: string | null
          current_rotation_index: number
          description: string | null
          email_body_template: string
          email_subject_template: string
          frequency: string
          id: string
          is_enabled: boolean
          last_sent_at: string | null
          mailbox_source: string
          name: string
          next_scheduled_at: string | null
          pipeline_id: string
          pipeline_name: string | null
          pipeline_stage_targets: Json
          report_type: string
          rotation_sequence: string[]
          sender_mailbox_email: string | null
          stage_id: string | null
          stage_name: string | null
          updated_at: string
        }
        Insert: {
          audience_segment?: string
          content_rotation_enabled?: boolean
          created_at?: string
          created_by?: string | null
          current_rotation_index?: number
          description?: string | null
          email_body_template?: string
          email_subject_template?: string
          frequency?: string
          id?: string
          is_enabled?: boolean
          last_sent_at?: string | null
          mailbox_source?: string
          name: string
          next_scheduled_at?: string | null
          pipeline_id: string
          pipeline_name?: string | null
          pipeline_stage_targets?: Json
          report_type?: string
          rotation_sequence?: string[]
          sender_mailbox_email?: string | null
          stage_id?: string | null
          stage_name?: string | null
          updated_at?: string
        }
        Update: {
          audience_segment?: string
          content_rotation_enabled?: boolean
          created_at?: string
          created_by?: string | null
          current_rotation_index?: number
          description?: string | null
          email_body_template?: string
          email_subject_template?: string
          frequency?: string
          id?: string
          is_enabled?: boolean
          last_sent_at?: string | null
          mailbox_source?: string
          name?: string
          next_scheduled_at?: string | null
          pipeline_id?: string
          pipeline_name?: string | null
          pipeline_stage_targets?: Json
          report_type?: string
          rotation_sequence?: string[]
          sender_mailbox_email?: string | null
          stage_id?: string | null
          stage_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_report_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_reports: {
        Row: {
          anomalies_snapshot: Json | null
          content: string
          created_at: string
          created_by: string | null
          date_preset: string | null
          forecast_data: Json | null
          health_snapshot: Json | null
          id: string
          metrics_snapshot: Json | null
          period_end: string
          period_start: string
          recommendations: Json | null
          report_type: string
          title: string
          updated_at: string
        }
        Insert: {
          anomalies_snapshot?: Json | null
          content?: string
          created_at?: string
          created_by?: string | null
          date_preset?: string | null
          forecast_data?: Json | null
          health_snapshot?: Json | null
          id?: string
          metrics_snapshot?: Json | null
          period_end: string
          period_start: string
          recommendations?: Json | null
          report_type?: string
          title: string
          updated_at?: string
        }
        Update: {
          anomalies_snapshot?: Json | null
          content?: string
          created_at?: string
          created_by?: string | null
          date_preset?: string | null
          forecast_data?: Json | null
          health_snapshot?: Json | null
          id?: string
          metrics_snapshot?: Json | null
          period_end?: string
          period_start?: string
          recommendations?: Json | null
          report_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      median_rent_cache: {
        Row: {
          bedrooms: number
          created_at: string
          data_quality: string
          expires_at: string
          fetched_at: string
          id: string
          median_weekly_rent: number | null
          postcode: string
          property_type: string
          source_url: string | null
          state: string
          stock_on_market: number | null
          suburb: string
          updated_at: string
          vacancy_rate: number | null
        }
        Insert: {
          bedrooms: number
          created_at?: string
          data_quality?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          median_weekly_rent?: number | null
          postcode: string
          property_type: string
          source_url?: string | null
          state: string
          stock_on_market?: number | null
          suburb: string
          updated_at?: string
          vacancy_rate?: number | null
        }
        Update: {
          bedrooms?: number
          created_at?: string
          data_quality?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          median_weekly_rent?: number | null
          postcode?: string
          property_type?: string
          source_url?: string | null
          state?: string
          stock_on_market?: number | null
          suburb?: string
          updated_at?: string
          vacancy_rate?: number | null
        }
        Relationships: []
      }
      message_governance_log: {
        Row: {
          allocation_status: Database["public"]["Enums"]["message_allocation_status"]
          attachment_metadata: Json | null
          client_id: string | null
          created_at: string
          event_type: string
          id: string
          message_id: string | null
          metadata: Json
          notification_status: Json
          permission_status: Json
          recipient_portals: string[]
          sender_portal: string
          sender_user_id: string | null
          source_table: string | null
          thread_id: string | null
          thread_type: string
          visibility_scope: Database["public"]["Enums"]["message_visibility_scope"]
        }
        Insert: {
          allocation_status?: Database["public"]["Enums"]["message_allocation_status"]
          attachment_metadata?: Json | null
          client_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          message_id?: string | null
          metadata?: Json
          notification_status?: Json
          permission_status?: Json
          recipient_portals?: string[]
          sender_portal: string
          sender_user_id?: string | null
          source_table?: string | null
          thread_id?: string | null
          thread_type: string
          visibility_scope: Database["public"]["Enums"]["message_visibility_scope"]
        }
        Update: {
          allocation_status?: Database["public"]["Enums"]["message_allocation_status"]
          attachment_metadata?: Json | null
          client_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          message_id?: string | null
          metadata?: Json
          notification_status?: Json
          permission_status?: Json
          recipient_portals?: string[]
          sender_portal?: string
          sender_user_id?: string | null
          source_table?: string | null
          thread_id?: string | null
          thread_type?: string
          visibility_scope?: Database["public"]["Enums"]["message_visibility_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "message_governance_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_webauthn_challenges: {
        Row: {
          capability: string | null
          challenge_b64url: string
          created_at: string
          expires_at: string
          id: string
          purpose: string
          staff_session_id: string | null
          token_hash: string | null
          user_id: string
        }
        Insert: {
          capability?: string | null
          challenge_b64url: string
          created_at?: string
          expires_at: string
          id?: string
          purpose: string
          staff_session_id?: string | null
          token_hash?: string | null
          user_id: string
        }
        Update: {
          capability?: string | null
          challenge_b64url?: string
          created_at?: string
          expires_at?: string
          id?: string
          purpose?: string
          staff_session_id?: string | null
          token_hash?: string | null
          user_id?: string
        }
        Relationships: []
      }
      migration_job_items: {
        Row: {
          attempts: number
          created_at: string
          entity_label: string | null
          error_category: string | null
          error_message: string | null
          id: string
          is_retryable: boolean | null
          job_id: string
          processed_at: string | null
          source_id: string
          status: string
          target_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          entity_label?: string | null
          error_category?: string | null
          error_message?: string | null
          id?: string
          is_retryable?: boolean | null
          job_id: string
          processed_at?: string | null
          source_id: string
          status?: string
          target_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          entity_label?: string | null
          error_category?: string | null
          error_message?: string | null
          id?: string
          is_retryable?: boolean | null
          job_id?: string
          processed_at?: string | null
          source_id?: string
          status?: string
          target_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "migration_job_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "migration_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_jobs: {
        Row: {
          auto_resume: boolean
          completed_at: string | null
          control_signal: string | null
          created_at: string
          created_by: string | null
          dispatch_count: number
          domain: string
          dry_run: boolean
          error_summary: string | null
          failed_items: number
          heartbeat_at: string | null
          id: string
          last_dispatched_at: string | null
          last_processed_source_id: string | null
          max_dispatches: number
          payload: Json
          processed_items: number
          resume_cursor: Json
          source_account: string
          started_at: string | null
          status: string
          succeeded_items: number
          target_account: string
          total_items: number
          updated_at: string
          worker_lock_until: string | null
        }
        Insert: {
          auto_resume?: boolean
          completed_at?: string | null
          control_signal?: string | null
          created_at?: string
          created_by?: string | null
          dispatch_count?: number
          domain: string
          dry_run?: boolean
          error_summary?: string | null
          failed_items?: number
          heartbeat_at?: string | null
          id?: string
          last_dispatched_at?: string | null
          last_processed_source_id?: string | null
          max_dispatches?: number
          payload?: Json
          processed_items?: number
          resume_cursor?: Json
          source_account: string
          started_at?: string | null
          status?: string
          succeeded_items?: number
          target_account: string
          total_items?: number
          updated_at?: string
          worker_lock_until?: string | null
        }
        Update: {
          auto_resume?: boolean
          completed_at?: string | null
          control_signal?: string | null
          created_at?: string
          created_by?: string | null
          dispatch_count?: number
          domain?: string
          dry_run?: boolean
          error_summary?: string | null
          failed_items?: number
          heartbeat_at?: string | null
          id?: string
          last_dispatched_at?: string | null
          last_processed_source_id?: string | null
          max_dispatches?: number
          payload?: Json
          processed_items?: number
          resume_cursor?: Json
          source_account?: string
          started_at?: string | null
          status?: string
          succeeded_items?: number
          target_account?: string
          total_items?: number
          updated_at?: string
          worker_lock_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "migration_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_uploaded_source_chunks: {
        Row: {
          chunk_index: number
          created_at: string
          id: string
          records: Json
          row_count: number
          upload_id: string
        }
        Insert: {
          chunk_index: number
          created_at?: string
          id?: string
          records: Json
          row_count: number
          upload_id: string
        }
        Update: {
          chunk_index?: number
          created_at?: string
          id?: string
          records?: Json
          row_count?: number
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "migration_uploaded_source_chunks_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "migration_uploaded_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_uploaded_sources: {
        Row: {
          created_at: string
          domain: string
          expected_rows: number | null
          file_name: string | null
          id: string
          notes: string | null
          progress_percent: number
          records: Json
          row_count: number
          status: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          domain: string
          expected_rows?: number | null
          file_name?: string | null
          id?: string
          notes?: string | null
          progress_percent?: number
          records?: Json
          row_count?: number
          status?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          domain?: string
          expected_rows?: number | null
          file_name?: string | null
          id?: string
          notes?: string | null
          progress_percent?: number
          records?: Json
          row_count?: number
          status?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      model_catalog_cache: {
        Row: {
          capabilities: string[] | null
          context_window: number | null
          display_name: string | null
          expires_at: string
          id: string
          last_probed_at: string
          model_id: string
          pricing_input_per_1m: number | null
          pricing_output_per_1m: number | null
          probe_error: string | null
          provider: string
          raw_metadata: Json | null
          route: string
          status: string
        }
        Insert: {
          capabilities?: string[] | null
          context_window?: number | null
          display_name?: string | null
          expires_at?: string
          id?: string
          last_probed_at?: string
          model_id: string
          pricing_input_per_1m?: number | null
          pricing_output_per_1m?: number | null
          probe_error?: string | null
          provider: string
          raw_metadata?: Json | null
          route: string
          status?: string
        }
        Update: {
          capabilities?: string[] | null
          context_window?: number | null
          display_name?: string | null
          expires_at?: string
          id?: string
          last_probed_at?: string
          model_id?: string
          pricing_input_per_1m?: number | null
          pricing_output_per_1m?: number | null
          probe_error?: string | null
          provider?: string
          raw_metadata?: Json | null
          route?: string
          status?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          entity_id: string | null
          id: string
          message: string
          read: boolean
          report_id: string | null
          target_user_id: string | null
          timestamp: string
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          id?: string
          message: string
          read?: boolean
          report_id?: string | null
          target_user_id?: string | null
          timestamp?: string
          title: string
          type: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          id?: string
          message?: string
          read?: boolean
          report_id?: string | null
          target_user_id?: string | null
          timestamp?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      password_reset_tokens: {
        Row: {
          attempts: number
          created_at: string
          expires_at: string
          id: string
          otp_code: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          expires_at: string
          id?: string
          otp_code: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          expires_at?: string
          id?: string
          otp_code?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "password_reset_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      pdf_import_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          diagnostics_path: string | null
          file_hash: string | null
          id: string
          job_id: string | null
          metadata: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          diagnostics_path?: string | null
          file_hash?: string | null
          id?: string
          job_id?: string | null
          metadata?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          diagnostics_path?: string | null
          file_hash?: string | null
          id?: string
          job_id?: string | null
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "pdf_import_audit_log_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "pdf_import_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      pdf_import_chunks: {
        Row: {
          artifact_paths: Json
          attempts: number
          chunk_index: number
          created_at: string
          dispatched_at: string | null
          duration_ms: number | null
          error_code: string | null
          error_text: string | null
          finished_at: string | null
          id: string
          job_id: string
          last_event_at: string
          max_attempts: number
          operational_metrics: Json | null
          page_count: number | null
          page_end: number
          page_start: number
          parent_chunk_id: string | null
          status: string
          summary: Json
          updated_at: string
        }
        Insert: {
          artifact_paths?: Json
          attempts?: number
          chunk_index: number
          created_at?: string
          dispatched_at?: string | null
          duration_ms?: number | null
          error_code?: string | null
          error_text?: string | null
          finished_at?: string | null
          id?: string
          job_id: string
          last_event_at?: string
          max_attempts?: number
          operational_metrics?: Json | null
          page_count?: number | null
          page_end: number
          page_start: number
          parent_chunk_id?: string | null
          status?: string
          summary?: Json
          updated_at?: string
        }
        Update: {
          artifact_paths?: Json
          attempts?: number
          chunk_index?: number
          created_at?: string
          dispatched_at?: string | null
          duration_ms?: number | null
          error_code?: string | null
          error_text?: string | null
          finished_at?: string | null
          id?: string
          job_id?: string
          last_event_at?: string
          max_attempts?: number
          operational_metrics?: Json | null
          page_count?: number | null
          page_end?: number
          page_start?: number
          parent_chunk_id?: string | null
          status?: string
          summary?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pdf_import_chunks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "pdf_import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdf_import_chunks_parent_chunk_id_fkey"
            columns: ["parent_chunk_id"]
            isOneToOne: false
            referencedRelation: "pdf_import_chunks"
            referencedColumns: ["id"]
          },
        ]
      }
      pdf_import_client_reports: {
        Row: {
          approval_note: string | null
          approved_at: string | null
          approved_by: string | null
          audience: string
          created_at: string
          export_format: string | null
          export_note: string | null
          exported_at: string | null
          exported_by: string | null
          generated_at: string
          generated_by: string | null
          id: string
          import_id: string | null
          redactions: Json
          rejected_at: string | null
          rejected_by: string | null
          rejection_note: string | null
          report_payload: Json
          report_type: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          safety_level: string
          source_summary: Json
          status: string
          summary: string
          superseded_at: string | null
          superseded_by: string | null
          template_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          audience: string
          created_at?: string
          export_format?: string | null
          export_note?: string | null
          exported_at?: string | null
          exported_by?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          import_id?: string | null
          redactions?: Json
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_note?: string | null
          report_payload?: Json
          report_type: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          safety_level: string
          source_summary?: Json
          status?: string
          summary: string
          superseded_at?: string | null
          superseded_by?: string | null
          template_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          audience?: string
          created_at?: string
          export_format?: string | null
          export_note?: string | null
          exported_at?: string | null
          exported_by?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          import_id?: string | null
          redactions?: Json
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_note?: string | null
          report_payload?: Json
          report_type?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          safety_level?: string
          source_summary?: Json
          status?: string
          summary?: string
          superseded_at?: string | null
          superseded_by?: string | null
          template_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pdf_import_client_reports_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "template_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdf_import_client_reports_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "pdf_import_client_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdf_import_client_reports_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      pdf_import_golden_runs: {
        Row: {
          ai_reconciliation_recommendation: string | null
          ai_reconciliation_status: string | null
          baseline_comparison: Json | null
          category: string
          corpus_id: string
          created_at: string
          created_by: string | null
          editor_vs_source_score: number | null
          engine_version: string | null
          export_parity_mode: string | null
          export_parity_status: string | null
          export_vs_editor_score: number | null
          export_vs_source_score: number | null
          failure_count: number
          failures: Json
          gate_summary: Json
          golden_regression_summary: Json
          id: string
          import_id: string
          import_page_count: number | null
          import_status: string | null
          operator_decision: string
          orchestrator_version: string | null
          quality_gate_status: string
          repair_final_score: number | null
          repair_requires_fallback: boolean | null
          repair_requires_manual_review: boolean | null
          repair_status: string | null
          run_batch_id: string | null
          run_decision: string | null
          run_id: string
          run_status: string | null
          source_filename: string | null
          summary_version: string | null
          template_id: string | null
          template_page_count: number | null
          triage_summary: Json
          updated_at: string
          visual_qa_manual_review_required: boolean | null
          visual_qa_score: number | null
          warning_count: number
          warnings: Json
        }
        Insert: {
          ai_reconciliation_recommendation?: string | null
          ai_reconciliation_status?: string | null
          baseline_comparison?: Json | null
          category: string
          corpus_id: string
          created_at?: string
          created_by?: string | null
          editor_vs_source_score?: number | null
          engine_version?: string | null
          export_parity_mode?: string | null
          export_parity_status?: string | null
          export_vs_editor_score?: number | null
          export_vs_source_score?: number | null
          failure_count?: number
          failures?: Json
          gate_summary?: Json
          golden_regression_summary?: Json
          id?: string
          import_id: string
          import_page_count?: number | null
          import_status?: string | null
          operator_decision: string
          orchestrator_version?: string | null
          quality_gate_status: string
          repair_final_score?: number | null
          repair_requires_fallback?: boolean | null
          repair_requires_manual_review?: boolean | null
          repair_status?: string | null
          run_batch_id?: string | null
          run_decision?: string | null
          run_id: string
          run_status?: string | null
          source_filename?: string | null
          summary_version?: string | null
          template_id?: string | null
          template_page_count?: number | null
          triage_summary?: Json
          updated_at?: string
          visual_qa_manual_review_required?: boolean | null
          visual_qa_score?: number | null
          warning_count?: number
          warnings?: Json
        }
        Update: {
          ai_reconciliation_recommendation?: string | null
          ai_reconciliation_status?: string | null
          baseline_comparison?: Json | null
          category?: string
          corpus_id?: string
          created_at?: string
          created_by?: string | null
          editor_vs_source_score?: number | null
          engine_version?: string | null
          export_parity_mode?: string | null
          export_parity_status?: string | null
          export_vs_editor_score?: number | null
          export_vs_source_score?: number | null
          failure_count?: number
          failures?: Json
          gate_summary?: Json
          golden_regression_summary?: Json
          id?: string
          import_id?: string
          import_page_count?: number | null
          import_status?: string | null
          operator_decision?: string
          orchestrator_version?: string | null
          quality_gate_status?: string
          repair_final_score?: number | null
          repair_requires_fallback?: boolean | null
          repair_requires_manual_review?: boolean | null
          repair_status?: string | null
          run_batch_id?: string | null
          run_decision?: string | null
          run_id?: string
          run_status?: string | null
          source_filename?: string | null
          summary_version?: string | null
          template_id?: string | null
          template_page_count?: number | null
          triage_summary?: Json
          updated_at?: string
          visual_qa_manual_review_required?: boolean | null
          visual_qa_score?: number | null
          warning_count?: number
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "pdf_import_golden_runs_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "template_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdf_import_golden_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      pdf_import_jobs: {
        Row: {
          attempts: Json
          bytes_in: number | null
          bytes_out: number | null
          cache_contract_fingerprint: string | null
          cache_hit: boolean
          cache_source_job_id: string | null
          callback_received_at: string | null
          chunked: boolean
          chunks_completed: number
          chunks_failed: number
          chunks_total: number | null
          cloud_run_ms: number | null
          created_at: string
          diagnostics_path: string | null
          duration_ms: number | null
          engine: string
          engine_version: string | null
          error_code: string | null
          error_text: string | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          mode: string
          operational_metrics: Json | null
          page_count: number | null
          pages_completed: number | null
          pages_total: number | null
          plan_payload: Json
          request_payload: Json
          result_payload: Json
          service_class: string | null
          source_file_hash: string | null
          source_file_name: string | null
          source_file_path: string
          source_file_size_bytes: number | null
          ssim_score: number | null
          stage: string | null
          stage_started_at: string | null
          started_at: string | null
          status: string
          template_id: string | null
          template_import_id: string | null
          timed_out_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: Json
          bytes_in?: number | null
          bytes_out?: number | null
          cache_contract_fingerprint?: string | null
          cache_hit?: boolean
          cache_source_job_id?: string | null
          callback_received_at?: string | null
          chunked?: boolean
          chunks_completed?: number
          chunks_failed?: number
          chunks_total?: number | null
          cloud_run_ms?: number | null
          created_at?: string
          diagnostics_path?: string | null
          duration_ms?: number | null
          engine?: string
          engine_version?: string | null
          error_code?: string | null
          error_text?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          mode?: string
          operational_metrics?: Json | null
          page_count?: number | null
          pages_completed?: number | null
          pages_total?: number | null
          plan_payload?: Json
          request_payload?: Json
          result_payload?: Json
          service_class?: string | null
          source_file_hash?: string | null
          source_file_name?: string | null
          source_file_path: string
          source_file_size_bytes?: number | null
          ssim_score?: number | null
          stage?: string | null
          stage_started_at?: string | null
          started_at?: string | null
          status?: string
          template_id?: string | null
          template_import_id?: string | null
          timed_out_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: Json
          bytes_in?: number | null
          bytes_out?: number | null
          cache_contract_fingerprint?: string | null
          cache_hit?: boolean
          cache_source_job_id?: string | null
          callback_received_at?: string | null
          chunked?: boolean
          chunks_completed?: number
          chunks_failed?: number
          chunks_total?: number | null
          cloud_run_ms?: number | null
          created_at?: string
          diagnostics_path?: string | null
          duration_ms?: number | null
          engine?: string
          engine_version?: string | null
          error_code?: string | null
          error_text?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          mode?: string
          operational_metrics?: Json | null
          page_count?: number | null
          pages_completed?: number | null
          pages_total?: number | null
          plan_payload?: Json
          request_payload?: Json
          result_payload?: Json
          service_class?: string | null
          source_file_hash?: string | null
          source_file_name?: string | null
          source_file_path?: string
          source_file_size_bytes?: number | null
          ssim_score?: number | null
          stage?: string | null
          stage_started_at?: string | null
          started_at?: string | null
          status?: string
          template_id?: string | null
          template_import_id?: string | null
          timed_out_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pdf_import_jobs_template_import_id_fkey"
            columns: ["template_import_id"]
            isOneToOne: false
            referencedRelation: "template_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      pdf_import_monitoring_events: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          context: Json
          created_at: string
          domain: string
          event_key: string
          first_seen_at: string
          id: string
          last_seen_at: string
          metric_value: string | null
          note: string | null
          occurrence_count: number
          owner: string
          release_blocking: boolean
          resolved_at: string | null
          resolved_by: string | null
          rule_id: string
          runbook_anchor: string
          severity: string
          status: string
          summary: string
          suppressed_until: string | null
          threshold: string | null
          title: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          context?: Json
          created_at?: string
          domain: string
          event_key: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          metric_value?: string | null
          note?: string | null
          occurrence_count?: number
          owner?: string
          release_blocking?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          rule_id: string
          runbook_anchor?: string
          severity: string
          status?: string
          summary?: string
          suppressed_until?: string | null
          threshold?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          context?: Json
          created_at?: string
          domain?: string
          event_key?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          metric_value?: string | null
          note?: string | null
          occurrence_count?: number
          owner?: string
          release_blocking?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          rule_id?: string
          runbook_anchor?: string
          severity?: string
          status?: string
          summary?: string
          suppressed_until?: string | null
          threshold?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      pdf_import_retention_events: {
        Row: {
          approval_note: string | null
          approved_at: string | null
          approved_by: string | null
          block_note: string | null
          blocked_at: string | null
          blocked_by: string | null
          cleanup_action: string
          completed_at: string | null
          completed_by: string | null
          completion_note: string | null
          created_at: string
          decision: string
          dedupe_key: string
          domain: string
          estimated_bytes: number | null
          evidence: Json
          first_seen_at: string
          golden_run_id: string | null
          id: string
          import_id: string | null
          last_seen_at: string
          message: string
          monitoring_event_id: string | null
          object_created_at: string | null
          object_updated_at: string | null
          occurrence_count: number
          recommended_action: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_note: string | null
          retention_rule_id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          run_id: string | null
          safety_level: string
          scope_id: string
          scope_label: string | null
          scope_type: string
          source: string
          status: string
          storage_bucket: string | null
          storage_object_path: string | null
          template_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          block_note?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          cleanup_action: string
          completed_at?: string | null
          completed_by?: string | null
          completion_note?: string | null
          created_at?: string
          decision: string
          dedupe_key: string
          domain: string
          estimated_bytes?: number | null
          evidence?: Json
          first_seen_at?: string
          golden_run_id?: string | null
          id?: string
          import_id?: string | null
          last_seen_at?: string
          message: string
          monitoring_event_id?: string | null
          object_created_at?: string | null
          object_updated_at?: string | null
          occurrence_count?: number
          recommended_action: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_note?: string | null
          retention_rule_id: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string | null
          safety_level: string
          scope_id: string
          scope_label?: string | null
          scope_type: string
          source?: string
          status?: string
          storage_bucket?: string | null
          storage_object_path?: string | null
          template_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          block_note?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          cleanup_action?: string
          completed_at?: string | null
          completed_by?: string | null
          completion_note?: string | null
          created_at?: string
          decision?: string
          dedupe_key?: string
          domain?: string
          estimated_bytes?: number | null
          evidence?: Json
          first_seen_at?: string
          golden_run_id?: string | null
          id?: string
          import_id?: string | null
          last_seen_at?: string
          message?: string
          monitoring_event_id?: string | null
          object_created_at?: string | null
          object_updated_at?: string | null
          occurrence_count?: number
          recommended_action?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_note?: string | null
          retention_rule_id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string | null
          safety_level?: string
          scope_id?: string
          scope_label?: string | null
          scope_type?: string
          source?: string
          status?: string
          storage_bucket?: string | null
          storage_object_path?: string | null
          template_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pdf_import_retention_events_golden_run_id_fkey"
            columns: ["golden_run_id"]
            isOneToOne: false
            referencedRelation: "pdf_import_golden_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdf_import_retention_events_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "template_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdf_import_retention_events_monitoring_event_id_fkey"
            columns: ["monitoring_event_id"]
            isOneToOne: false
            referencedRelation: "pdf_import_monitoring_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdf_import_retention_events_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_invite_tokens: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invite_type: string
          invited_by: string
          mc_seat_id: string | null
          mc_seat_idempotency_key: string | null
          permissions: Json
          temporary_password: string | null
          token: string
          used_at: string | null
          username: string | null
        }
        Insert: {
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invite_type?: string
          invited_by: string
          mc_seat_id?: string | null
          mc_seat_idempotency_key?: string | null
          permissions?: Json
          temporary_password?: string | null
          token: string
          used_at?: string | null
          username?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invite_type?: string
          invited_by?: string
          mc_seat_id?: string | null
          mc_seat_idempotency_key?: string | null
          permissions?: Json
          temporary_password?: string | null
          token?: string
          used_at?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "permission_invite_tokens_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_configuration: {
        Row: {
          booking_calendar_id: string | null
          booking_calendar_name: string | null
          booking_calendars: Json | null
          booking_confirmation_email: boolean | null
          booking_intro_text: string | null
          booking_lead_time_hours: number | null
          booking_max_advance_days: number | null
          booking_slot_duration: number | null
          booking_team_notification_email: string | null
          booking_working_hours_end: number | null
          booking_working_hours_start: number | null
          created_at: string | null
          default_access_level: string | null
          id: string
          module_booking: boolean | null
          module_dashboard: boolean | null
          module_deal_progress: boolean | null
          module_documents: boolean | null
          module_emails: boolean | null
          module_employment: boolean | null
          module_messages: boolean | null
          module_notifications: boolean | null
          module_profile: boolean | null
          module_properties: boolean | null
          module_property_insights: boolean | null
          portal_accent_color: string | null
          portal_footer_text: string | null
          updated_at: string | null
          welcome_banner_url: string | null
          welcome_message: string | null
          welcome_title: string | null
        }
        Insert: {
          booking_calendar_id?: string | null
          booking_calendar_name?: string | null
          booking_calendars?: Json | null
          booking_confirmation_email?: boolean | null
          booking_intro_text?: string | null
          booking_lead_time_hours?: number | null
          booking_max_advance_days?: number | null
          booking_slot_duration?: number | null
          booking_team_notification_email?: string | null
          booking_working_hours_end?: number | null
          booking_working_hours_start?: number | null
          created_at?: string | null
          default_access_level?: string | null
          id?: string
          module_booking?: boolean | null
          module_dashboard?: boolean | null
          module_deal_progress?: boolean | null
          module_documents?: boolean | null
          module_emails?: boolean | null
          module_employment?: boolean | null
          module_messages?: boolean | null
          module_notifications?: boolean | null
          module_profile?: boolean | null
          module_properties?: boolean | null
          module_property_insights?: boolean | null
          portal_accent_color?: string | null
          portal_footer_text?: string | null
          updated_at?: string | null
          welcome_banner_url?: string | null
          welcome_message?: string | null
          welcome_title?: string | null
        }
        Update: {
          booking_calendar_id?: string | null
          booking_calendar_name?: string | null
          booking_calendars?: Json | null
          booking_confirmation_email?: boolean | null
          booking_intro_text?: string | null
          booking_lead_time_hours?: number | null
          booking_max_advance_days?: number | null
          booking_slot_duration?: number | null
          booking_team_notification_email?: string | null
          booking_working_hours_end?: number | null
          booking_working_hours_start?: number | null
          created_at?: string | null
          default_access_level?: string | null
          id?: string
          module_booking?: boolean | null
          module_dashboard?: boolean | null
          module_deal_progress?: boolean | null
          module_documents?: boolean | null
          module_emails?: boolean | null
          module_employment?: boolean | null
          module_messages?: boolean | null
          module_notifications?: boolean | null
          module_profile?: boolean | null
          module_properties?: boolean | null
          module_property_insights?: boolean | null
          portal_accent_color?: string | null
          portal_footer_text?: string | null
          updated_at?: string | null
          welcome_banner_url?: string | null
          welcome_message?: string | null
          welcome_title?: string | null
        }
        Relationships: []
      }
      portfolio_analysis_reports: {
        Row: {
          average_lvr: number | null
          average_yield: number | null
          client_id: string
          client_name: string
          created_at: string
          generated_by: string | null
          health_score: number | null
          id: string
          net_monthly_cashflow: number | null
          overall_health: string | null
          pdf_file_path: string | null
          portfolio_value: number | null
          report_data: Json
          status: string
          total_equity: number | null
          total_properties: number | null
          updated_at: string
        }
        Insert: {
          average_lvr?: number | null
          average_yield?: number | null
          client_id: string
          client_name: string
          created_at?: string
          generated_by?: string | null
          health_score?: number | null
          id?: string
          net_monthly_cashflow?: number | null
          overall_health?: string | null
          pdf_file_path?: string | null
          portfolio_value?: number | null
          report_data: Json
          status?: string
          total_equity?: number | null
          total_properties?: number | null
          updated_at?: string
        }
        Update: {
          average_lvr?: number | null
          average_yield?: number | null
          client_id?: string
          client_name?: string
          created_at?: string
          generated_by?: string | null
          health_score?: number | null
          id?: string
          net_monthly_cashflow?: number | null
          overall_health?: string | null
          pdf_file_path?: string | null
          portfolio_value?: number | null
          report_data?: Json
          status?: string
          total_equity?: number | null
          total_properties?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_analysis_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_analysis_reports_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_analysis_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_default: boolean | null
          name: string
          settings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_analysis_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_reviews: {
        Row: {
          action_items: Json | null
          cash_flow_score: number | null
          client_id: string
          created_at: string
          data_completeness_score: number | null
          data_issues: Json | null
          executive_summary: string | null
          growth_potential: number | null
          id: string
          include_owner_occupied: boolean
          key_findings: Json | null
          next_review_due: string | null
          notes: string | null
          overall_score: number | null
          portfolio_health: number | null
          property_scores: Json | null
          recommendations: Json | null
          review_date: string
          review_frequency: string
          reviewer_id: string | null
          risk_level: string | null
          scenarios: Json | null
          status: string
          updated_at: string
          validation_flags: Json | null
        }
        Insert: {
          action_items?: Json | null
          cash_flow_score?: number | null
          client_id: string
          created_at?: string
          data_completeness_score?: number | null
          data_issues?: Json | null
          executive_summary?: string | null
          growth_potential?: number | null
          id?: string
          include_owner_occupied?: boolean
          key_findings?: Json | null
          next_review_due?: string | null
          notes?: string | null
          overall_score?: number | null
          portfolio_health?: number | null
          property_scores?: Json | null
          recommendations?: Json | null
          review_date?: string
          review_frequency: string
          reviewer_id?: string | null
          risk_level?: string | null
          scenarios?: Json | null
          status?: string
          updated_at?: string
          validation_flags?: Json | null
        }
        Update: {
          action_items?: Json | null
          cash_flow_score?: number | null
          client_id?: string
          created_at?: string
          data_completeness_score?: number | null
          data_issues?: Json | null
          executive_summary?: string | null
          growth_potential?: number | null
          id?: string
          include_owner_occupied?: boolean
          key_findings?: Json | null
          next_review_due?: string | null
          notes?: string | null
          overall_score?: number | null
          portfolio_health?: number | null
          property_scores?: Json | null
          recommendations?: Json | null
          review_date?: string
          review_frequency?: string
          reviewer_id?: string | null
          risk_level?: string | null
          scenarios?: Json | null
          status?: string
          updated_at?: string
          validation_flags?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_reviews_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      property_comparisons: {
        Row: {
          analysis_depth: string | null
          analysis_summary: string | null
          created_at: string
          created_by: string | null
          executive_summary: string | null
          financial_comparison: Json | null
          id: string
          investor_matches: Json | null
          investor_profile: string | null
          is_archived: boolean
          location_comparison: Json | null
          model_used: string | null
          processing_time_ms: number | null
          property_addresses: string[] | null
          property_count: number
          property_states: string[] | null
          rankings: Json | null
          recommendations: Json | null
          red_flags: Json | null
          report_ids: string[]
          report_title: string | null
          risk_comparison: Json | null
          structure_version: number | null
          updated_at: string
        }
        Insert: {
          analysis_depth?: string | null
          analysis_summary?: string | null
          created_at?: string
          created_by?: string | null
          executive_summary?: string | null
          financial_comparison?: Json | null
          id?: string
          investor_matches?: Json | null
          investor_profile?: string | null
          is_archived?: boolean
          location_comparison?: Json | null
          model_used?: string | null
          processing_time_ms?: number | null
          property_addresses?: string[] | null
          property_count: number
          property_states?: string[] | null
          rankings?: Json | null
          recommendations?: Json | null
          red_flags?: Json | null
          report_ids: string[]
          report_title?: string | null
          risk_comparison?: Json | null
          structure_version?: number | null
          updated_at?: string
        }
        Update: {
          analysis_depth?: string | null
          analysis_summary?: string | null
          created_at?: string
          created_by?: string | null
          executive_summary?: string | null
          financial_comparison?: Json | null
          id?: string
          investor_matches?: Json | null
          investor_profile?: string | null
          is_archived?: boolean
          location_comparison?: Json | null
          model_used?: string | null
          processing_time_ms?: number | null
          property_addresses?: string[] | null
          property_count?: number
          property_states?: string[] | null
          rankings?: Json | null
          recommendations?: Json | null
          red_flags?: Json | null
          report_ids?: string[]
          report_title?: string | null
          risk_comparison?: Json | null
          structure_version?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_comparisons_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      property_reclassification_log: {
        Row: {
          client_id: string | null
          created_at: string
          error_message: string | null
          id: string
          mapped_payload: Json
          performed_at: string
          performed_by: string | null
          reverted_at: string | null
          source_property_id: string
          source_snapshot: Json
          source_table: string
          status: string
          target_property_id: string | null
          target_table: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          mapped_payload?: Json
          performed_at?: string
          performed_by?: string | null
          reverted_at?: string | null
          source_property_id: string
          source_snapshot?: Json
          source_table: string
          status?: string
          target_property_id?: string | null
          target_table: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          mapped_payload?: Json
          performed_at?: string
          performed_by?: string | null
          reverted_at?: string | null
          source_property_id?: string
          source_snapshot?: Json
          source_table?: string
          status?: string
          target_property_id?: string | null
          target_table?: string
        }
        Relationships: []
      }
      property_scrape_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          property_category: string
          result: Json | null
          started_at: string | null
          status: string
          updated_at: string
          url: string
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          property_category?: string
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
          url: string
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          property_category?: string
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
          url?: string
          user_id?: string | null
        }
        Relationships: []
      }
      purchase_file_applicants: {
        Row: {
          created_at: string
          date_of_birth: string | null
          display_name: string
          email: string | null
          id: string
          is_primary: boolean
          metadata: Json
          phone: string | null
          position: number
          purchase_file_id: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_of_birth?: string | null
          display_name: string
          email?: string | null
          id?: string
          is_primary?: boolean
          metadata?: Json
          phone?: string | null
          position?: number
          purchase_file_id: string
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_of_birth?: string | null
          display_name?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          metadata?: Json
          phone?: string | null
          position?: number
          purchase_file_id?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_file_applicants_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_applicants_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      purchase_file_audit_events: {
        Row: {
          action: string
          actor_client_id: string | null
          actor_finance_user_id: string | null
          actor_team_user_id: string | null
          actor_type: string
          category: string
          client_deal_id: string | null
          client_id: string | null
          created_at: string
          description: string | null
          fields_accessed: string[] | null
          id: string
          ip_address: string | null
          is_redacted: boolean
          metadata: Json
          prev_hash: string | null
          purchase_file_id: string | null
          redacted_at: string | null
          retention_class: string
          row_hash: string | null
          severity: string
          target_id: string | null
          target_type: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_client_id?: string | null
          actor_finance_user_id?: string | null
          actor_team_user_id?: string | null
          actor_type: string
          category: string
          client_deal_id?: string | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          fields_accessed?: string[] | null
          id?: string
          ip_address?: string | null
          is_redacted?: boolean
          metadata?: Json
          prev_hash?: string | null
          purchase_file_id?: string | null
          redacted_at?: string | null
          retention_class?: string
          row_hash?: string | null
          severity?: string
          target_id?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_client_id?: string | null
          actor_finance_user_id?: string | null
          actor_team_user_id?: string | null
          actor_type?: string
          category?: string
          client_deal_id?: string | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          fields_accessed?: string[] | null
          id?: string
          ip_address?: string | null
          is_redacted?: boolean
          metadata?: Json
          prev_hash?: string | null
          purchase_file_id?: string | null
          redacted_at?: string | null
          retention_class?: string
          row_hash?: string | null
          severity?: string
          target_id?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_file_audit_events_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_audit_events_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      purchase_file_bank_statement_requests: {
        Row: {
          account_count: number | null
          applicant_id: string | null
          client_id: string | null
          consent_url: string | null
          created_at: string
          id: string
          initiated_by: string | null
          notes: string | null
          payload: Json
          period_days: number
          provider: string
          provider_ref: string | null
          purchase_file_id: string
          statements_received_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_count?: number | null
          applicant_id?: string | null
          client_id?: string | null
          consent_url?: string | null
          created_at?: string
          id?: string
          initiated_by?: string | null
          notes?: string | null
          payload?: Json
          period_days?: number
          provider?: string
          provider_ref?: string | null
          purchase_file_id: string
          statements_received_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_count?: number | null
          applicant_id?: string | null
          client_id?: string | null
          consent_url?: string | null
          created_at?: string
          id?: string
          initiated_by?: string | null
          notes?: string | null
          payload?: Json
          period_days?: number
          provider?: string
          provider_ref?: string | null
          purchase_file_id?: string
          statements_received_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_file_calculator_scenarios: {
        Row: {
          calculator_type: string
          created_at: string
          finance_user_id: string | null
          id: string
          inputs: Json
          is_pinned: boolean
          label: string | null
          purchase_file_id: string | null
          results: Json
          updated_at: string
        }
        Insert: {
          calculator_type: string
          created_at?: string
          finance_user_id?: string | null
          id?: string
          inputs?: Json
          is_pinned?: boolean
          label?: string | null
          purchase_file_id?: string | null
          results?: Json
          updated_at?: string
        }
        Update: {
          calculator_type?: string
          created_at?: string
          finance_user_id?: string | null
          id?: string
          inputs?: Json
          is_pinned?: boolean
          label?: string | null
          purchase_file_id?: string | null
          results?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_file_calculator_scenarios_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_calculator_scenarios_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      purchase_file_client_tasks: {
        Row: {
          client_id: string
          client_response_at: string | null
          client_response_text: string | null
          completed_at: string | null
          created_at: string
          created_by_finance_user_id: string | null
          description: string | null
          dismissed_at: string | null
          due_date: string | null
          id: string
          purchase_file_id: string
          related_condition_id: string | null
          related_decision_id: string | null
          related_document_instance_id: string | null
          status: Database["public"]["Enums"]["pf_client_task_status"]
          task_type: Database["public"]["Enums"]["pf_client_task_type"]
          title: string
          updated_at: string
        }
        Insert: {
          client_id: string
          client_response_at?: string | null
          client_response_text?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_finance_user_id?: string | null
          description?: string | null
          dismissed_at?: string | null
          due_date?: string | null
          id?: string
          purchase_file_id: string
          related_condition_id?: string | null
          related_decision_id?: string | null
          related_document_instance_id?: string | null
          status?: Database["public"]["Enums"]["pf_client_task_status"]
          task_type: Database["public"]["Enums"]["pf_client_task_type"]
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          client_response_at?: string | null
          client_response_text?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_finance_user_id?: string | null
          description?: string | null
          dismissed_at?: string | null
          due_date?: string | null
          id?: string
          purchase_file_id?: string
          related_condition_id?: string | null
          related_decision_id?: string | null
          related_document_instance_id?: string | null
          status?: Database["public"]["Enums"]["pf_client_task_status"]
          task_type?: Database["public"]["Enums"]["pf_client_task_type"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_file_client_tasks_created_by_finance_user_id_fkey"
            columns: ["created_by_finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_client_tasks_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_client_tasks_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
          {
            foreignKeyName: "purchase_file_client_tasks_related_condition_id_fkey"
            columns: ["related_condition_id"]
            isOneToOne: false
            referencedRelation: "purchase_file_conditions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_client_tasks_related_decision_id_fkey"
            columns: ["related_decision_id"]
            isOneToOne: false
            referencedRelation: "purchase_file_finance_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_client_tasks_related_document_instance_id_fkey"
            columns: ["related_document_instance_id"]
            isOneToOne: false
            referencedRelation: "document_requirement_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_file_condition_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          lender_key: string | null
          owner: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          lender_key?: string | null
          owner?: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          lender_key?: string | null
          owner?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_file_conditions: {
        Row: {
          client_id: string
          created_at: string
          created_by_finance_user_id: string | null
          created_by_team_user_id: string | null
          description: string | null
          document_id: string | null
          due_date: string | null
          id: string
          is_auto_generated: boolean
          notes: string | null
          owner: Database["public"]["Enums"]["condition_owner"]
          purchase_file_id: string
          satisfied_at: string | null
          satisfied_by_finance_user_id: string | null
          sort_order: number
          status: Database["public"]["Enums"]["condition_status"]
          title: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by_finance_user_id?: string | null
          created_by_team_user_id?: string | null
          description?: string | null
          document_id?: string | null
          due_date?: string | null
          id?: string
          is_auto_generated?: boolean
          notes?: string | null
          owner?: Database["public"]["Enums"]["condition_owner"]
          purchase_file_id: string
          satisfied_at?: string | null
          satisfied_by_finance_user_id?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["condition_status"]
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by_finance_user_id?: string | null
          created_by_team_user_id?: string | null
          description?: string | null
          document_id?: string | null
          due_date?: string | null
          id?: string
          is_auto_generated?: boolean
          notes?: string | null
          owner?: Database["public"]["Enums"]["condition_owner"]
          purchase_file_id?: string
          satisfied_at?: string | null
          satisfied_by_finance_user_id?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["condition_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_file_conditions_created_by_finance_user_id_fkey"
            columns: ["created_by_finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_conditions_created_by_team_user_id_fkey"
            columns: ["created_by_team_user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_conditions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_conditions_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_conditions_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
          {
            foreignKeyName: "purchase_file_conditions_satisfied_by_finance_user_id_fkey"
            columns: ["satisfied_by_finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_file_credit_checks: {
        Row: {
          applicant_id: string | null
          band: string | null
          client_id: string | null
          consent_given_at: string | null
          consent_ip: unknown
          consent_proof: Json
          created_at: string
          id: string
          initiated_by: string | null
          notes: string | null
          provider: string
          provider_ref: string | null
          purchase_file_id: string
          ran_at: string | null
          raw: Json
          report_url: string | null
          score: number | null
          status: string
          updated_at: string
        }
        Insert: {
          applicant_id?: string | null
          band?: string | null
          client_id?: string | null
          consent_given_at?: string | null
          consent_ip?: unknown
          consent_proof?: Json
          created_at?: string
          id?: string
          initiated_by?: string | null
          notes?: string | null
          provider?: string
          provider_ref?: string | null
          purchase_file_id: string
          ran_at?: string | null
          raw?: Json
          report_url?: string | null
          score?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          applicant_id?: string | null
          band?: string | null
          client_id?: string | null
          consent_given_at?: string | null
          consent_ip?: unknown
          consent_proof?: Json
          created_at?: string
          id?: string
          initiated_by?: string | null
          notes?: string | null
          provider?: string
          provider_ref?: string | null
          purchase_file_id?: string
          ran_at?: string | null
          raw?: Json
          report_url?: string | null
          score?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_file_critical_dates: {
        Row: {
          completed_at: string | null
          created_at: string
          date_type: Database["public"]["Enums"]["purchase_critical_date_type"]
          due_date: string | null
          id: string
          notes: string | null
          purchase_file_id: string
          status: Database["public"]["Enums"]["purchase_critical_date_status"]
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          date_type: Database["public"]["Enums"]["purchase_critical_date_type"]
          due_date?: string | null
          id?: string
          notes?: string | null
          purchase_file_id: string
          status?: Database["public"]["Enums"]["purchase_critical_date_status"]
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          date_type?: Database["public"]["Enums"]["purchase_critical_date_type"]
          due_date?: string | null
          id?: string
          notes?: string | null
          purchase_file_id?: string
          status?: Database["public"]["Enums"]["purchase_critical_date_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_file_critical_dates_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_critical_dates_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      purchase_file_deal_link_audit: {
        Row: {
          action: string
          actor_user_id: string | null
          client_deal_id: string | null
          client_id: string | null
          created_at: string
          id: string
          note: string | null
          purchase_file_id: string | null
          source: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          client_deal_id?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          purchase_file_id?: string | null
          source?: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          client_deal_id?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          purchase_file_id?: string | null
          source?: string
        }
        Relationships: []
      }
      purchase_file_discovery_signatures: {
        Row: {
          applicant_id: string | null
          client_id: string | null
          created_at: string
          doc_label: string | null
          doc_type: string
          document_url: string | null
          envelope_id: string | null
          id: string
          initiated_by: string | null
          metadata: Json
          provider: string
          purchase_file_id: string
          recipient_email: string | null
          recipient_name: string | null
          sent_at: string | null
          signed_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          applicant_id?: string | null
          client_id?: string | null
          created_at?: string
          doc_label?: string | null
          doc_type: string
          document_url?: string | null
          envelope_id?: string | null
          id?: string
          initiated_by?: string | null
          metadata?: Json
          provider?: string
          purchase_file_id: string
          recipient_email?: string | null
          recipient_name?: string | null
          sent_at?: string | null
          signed_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          applicant_id?: string | null
          client_id?: string | null
          created_at?: string
          doc_label?: string | null
          doc_type?: string
          document_url?: string | null
          envelope_id?: string | null
          id?: string
          initiated_by?: string | null
          metadata?: Json
          provider?: string
          purchase_file_id?: string
          recipient_email?: string | null
          recipient_name?: string | null
          sent_at?: string | null
          signed_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_file_doc_compliance_checks: {
        Row: {
          ai_summary: string | null
          applicant_id: string | null
          check_type: string
          created_at: string
          detected_date: string | null
          detected_doc_type: string | null
          detected_name: string | null
          document_id: string | null
          expires_at: string | null
          findings: Json
          id: string
          metadata: Json
          ocr_text: string | null
          purchase_file_id: string
          ran_at: string
          ran_by: string | null
          requirement_instance_id: string | null
          status: string
          tamper_score: number | null
          updated_at: string
        }
        Insert: {
          ai_summary?: string | null
          applicant_id?: string | null
          check_type?: string
          created_at?: string
          detected_date?: string | null
          detected_doc_type?: string | null
          detected_name?: string | null
          document_id?: string | null
          expires_at?: string | null
          findings?: Json
          id?: string
          metadata?: Json
          ocr_text?: string | null
          purchase_file_id: string
          ran_at?: string
          ran_by?: string | null
          requirement_instance_id?: string | null
          status?: string
          tamper_score?: number | null
          updated_at?: string
        }
        Update: {
          ai_summary?: string | null
          applicant_id?: string | null
          check_type?: string
          created_at?: string
          detected_date?: string | null
          detected_doc_type?: string | null
          detected_name?: string | null
          document_id?: string | null
          expires_at?: string | null
          findings?: Json
          id?: string
          metadata?: Json
          ocr_text?: string | null
          purchase_file_id?: string
          ran_at?: string
          ran_by?: string | null
          requirement_instance_id?: string | null
          status?: string
          tamper_score?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      purchase_file_entity_comments: {
        Row: {
          author_id: string | null
          author_name: string | null
          author_type: string
          body: string
          created_at: string
          deleted_at: string | null
          entity_id: string | null
          entity_type: string
          id: string
          mentions: string[] | null
          parent_id: string | null
          purchase_file_id: string
          updated_at: string
          visibility: string
        }
        Insert: {
          author_id?: string | null
          author_name?: string | null
          author_type: string
          body: string
          created_at?: string
          deleted_at?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          mentions?: string[] | null
          parent_id?: string | null
          purchase_file_id: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          author_id?: string | null
          author_name?: string | null
          author_type?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          mentions?: string[] | null
          parent_id?: string | null
          purchase_file_id?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_file_entity_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "purchase_file_entity_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_file_finance_decisions: {
        Row: {
          broker_notes: string | null
          client_id: string
          created_at: string
          decided_at: string
          decided_by_finance_user_id: string | null
          decided_by_team_user_id: string | null
          decision_expiry_date: string | null
          deposit_required: number | null
          estimated_borrowing_cap: number | null
          id: string
          lmi_amount: number | null
          lmi_applicable: boolean | null
          lvr: number | null
          max_comfortable_price: number | null
          outcome: Database["public"]["Enums"]["finance_decision_outcome"]
          preferred_lender_pathway: string | null
          proposed_loan_amount: number | null
          purchase_file_id: string
          rationale: string | null
          shortfall_required: number | null
          snapshot_client_contribution: number | null
          snapshot_estimated_rent_weekly: number | null
          snapshot_lender: string | null
          snapshot_max_approved_budget: number | null
          snapshot_purchase_price: number | null
          supporting_document_id: string | null
          updated_at: string
        }
        Insert: {
          broker_notes?: string | null
          client_id: string
          created_at?: string
          decided_at?: string
          decided_by_finance_user_id?: string | null
          decided_by_team_user_id?: string | null
          decision_expiry_date?: string | null
          deposit_required?: number | null
          estimated_borrowing_cap?: number | null
          id?: string
          lmi_amount?: number | null
          lmi_applicable?: boolean | null
          lvr?: number | null
          max_comfortable_price?: number | null
          outcome: Database["public"]["Enums"]["finance_decision_outcome"]
          preferred_lender_pathway?: string | null
          proposed_loan_amount?: number | null
          purchase_file_id: string
          rationale?: string | null
          shortfall_required?: number | null
          snapshot_client_contribution?: number | null
          snapshot_estimated_rent_weekly?: number | null
          snapshot_lender?: string | null
          snapshot_max_approved_budget?: number | null
          snapshot_purchase_price?: number | null
          supporting_document_id?: string | null
          updated_at?: string
        }
        Update: {
          broker_notes?: string | null
          client_id?: string
          created_at?: string
          decided_at?: string
          decided_by_finance_user_id?: string | null
          decided_by_team_user_id?: string | null
          decision_expiry_date?: string | null
          deposit_required?: number | null
          estimated_borrowing_cap?: number | null
          id?: string
          lmi_amount?: number | null
          lmi_applicable?: boolean | null
          lvr?: number | null
          max_comfortable_price?: number | null
          outcome?: Database["public"]["Enums"]["finance_decision_outcome"]
          preferred_lender_pathway?: string | null
          proposed_loan_amount?: number | null
          purchase_file_id?: string
          rationale?: string | null
          shortfall_required?: number | null
          snapshot_client_contribution?: number | null
          snapshot_estimated_rent_weekly?: number | null
          snapshot_lender?: string | null
          snapshot_max_approved_budget?: number | null
          snapshot_purchase_price?: number | null
          supporting_document_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_file_finance_decisions_decided_by_finance_user_id_fkey"
            columns: ["decided_by_finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_finance_decisions_decided_by_team_user_id_fkey"
            columns: ["decided_by_team_user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_finance_decisions_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_finance_decisions_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
          {
            foreignKeyName: "purchase_file_finance_decisions_supporting_document_id_fkey"
            columns: ["supporting_document_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_file_lender_packets: {
        Row: {
          client_id: string
          cover_sheet_included: boolean
          created_at: string
          download_count: number
          file_count: number
          filename: string
          generated_by_email: string | null
          generated_by_finance_user_id: string | null
          id: string
          last_downloaded_at: string | null
          lender_key: string | null
          lender_name: string | null
          manifest: Json
          missing_required: Json
          missing_required_count: number
          notes: string | null
          purchase_file_id: string
          quality_flags: Json
          total_size_bytes: number | null
          updated_at: string
        }
        Insert: {
          client_id: string
          cover_sheet_included?: boolean
          created_at?: string
          download_count?: number
          file_count?: number
          filename: string
          generated_by_email?: string | null
          generated_by_finance_user_id?: string | null
          id?: string
          last_downloaded_at?: string | null
          lender_key?: string | null
          lender_name?: string | null
          manifest?: Json
          missing_required?: Json
          missing_required_count?: number
          notes?: string | null
          purchase_file_id: string
          quality_flags?: Json
          total_size_bytes?: number | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          cover_sheet_included?: boolean
          created_at?: string
          download_count?: number
          file_count?: number
          filename?: string
          generated_by_email?: string | null
          generated_by_finance_user_id?: string | null
          id?: string
          last_downloaded_at?: string | null
          lender_key?: string | null
          lender_name?: string | null
          manifest?: Json
          missing_required?: Json
          missing_required_count?: number
          notes?: string | null
          purchase_file_id?: string
          quality_flags?: Json
          total_size_bytes?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_file_lender_packets_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_lender_packets_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      purchase_file_nccp_bundles: {
        Row: {
          bundle_url: string | null
          completeness_pct: number | null
          created_at: string
          generated_at: string
          generated_by: string | null
          id: string
          manifest: Json
          metadata: Json
          missing_items: Json
          notes: string | null
          purchase_file_id: string
          status: string
          updated_at: string
        }
        Insert: {
          bundle_url?: string | null
          completeness_pct?: number | null
          created_at?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          manifest?: Json
          metadata?: Json
          missing_items?: Json
          notes?: string | null
          purchase_file_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          bundle_url?: string | null
          completeness_pct?: number | null
          created_at?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          manifest?: Json
          metadata?: Json
          missing_items?: Json
          notes?: string | null
          purchase_file_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_file_onboarding_checklist: {
        Row: {
          category: string
          client_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          description: string | null
          id: string
          label: string
          metadata: Json
          owner: string
          position: number
          purchase_file_id: string
          status: string
          step_key: string
          updated_at: string
          visible_to_client: boolean
        }
        Insert: {
          category?: string
          client_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          description?: string | null
          id?: string
          label: string
          metadata?: Json
          owner?: string
          position?: number
          purchase_file_id: string
          status?: string
          step_key: string
          updated_at?: string
          visible_to_client?: boolean
        }
        Update: {
          category?: string
          client_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          description?: string | null
          id?: string
          label?: string
          metadata?: Json
          owner?: string
          position?: number
          purchase_file_id?: string
          status?: string
          step_key?: string
          updated_at?: string
          visible_to_client?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "purchase_file_onboarding_checklist_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_onboarding_checklist_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      purchase_file_outcomes: {
        Row: {
          created_at: string
          finance_contact_id: string | null
          id: string
          lender: string | null
          loan_amount: number | null
          outcome: string
          purchase_file_id: string
          reason_category: string | null
          reason_detail: string | null
          recorded_at: string
          recorded_by: string | null
        }
        Insert: {
          created_at?: string
          finance_contact_id?: string | null
          id?: string
          lender?: string | null
          loan_amount?: number | null
          outcome: string
          purchase_file_id: string
          reason_category?: string | null
          reason_detail?: string | null
          recorded_at?: string
          recorded_by?: string | null
        }
        Update: {
          created_at?: string
          finance_contact_id?: string | null
          id?: string
          lender?: string | null
          loan_amount?: number | null
          outcome?: string
          purchase_file_id?: string
          reason_category?: string | null
          reason_detail?: string | null
          recorded_at?: string
          recorded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_file_outcomes_finance_contact_id_fkey"
            columns: ["finance_contact_id"]
            isOneToOne: false
            referencedRelation: "finance_agent_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_outcomes_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_outcomes_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      purchase_file_risks: {
        Row: {
          category: string
          client_id: string
          created_at: string
          created_by_finance_user_id: string | null
          created_by_team_user_id: string | null
          description: string | null
          due_date: string | null
          id: string
          owner: string
          purchase_file_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by_finance_user_id: string | null
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          client_id: string
          created_at?: string
          created_by_finance_user_id?: string | null
          created_by_team_user_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          owner?: string
          purchase_file_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by_finance_user_id?: string | null
          severity?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          client_id?: string
          created_at?: string
          created_by_finance_user_id?: string | null
          created_by_team_user_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          owner?: string
          purchase_file_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by_finance_user_id?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_file_risks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_risks_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_risks_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      purchase_file_settlement_tasks: {
        Row: {
          blocked_reason: string | null
          client_id: string
          completed_at: string | null
          completed_by_finance_user_id: string | null
          completed_by_team_user_id: string | null
          created_at: string
          created_by_finance_user_id: string | null
          created_by_team_user_id: string | null
          description: string | null
          due_date: string | null
          due_offset_days: number | null
          id: string
          is_auto_seeded: boolean
          is_required: boolean
          label: string
          notes: string | null
          owner: string
          purchase_file_id: string
          sort_order: number
          status: Database["public"]["Enums"]["pf_settlement_task_status"]
          task_key: Database["public"]["Enums"]["pf_settlement_task_key"]
          updated_at: string
        }
        Insert: {
          blocked_reason?: string | null
          client_id: string
          completed_at?: string | null
          completed_by_finance_user_id?: string | null
          completed_by_team_user_id?: string | null
          created_at?: string
          created_by_finance_user_id?: string | null
          created_by_team_user_id?: string | null
          description?: string | null
          due_date?: string | null
          due_offset_days?: number | null
          id?: string
          is_auto_seeded?: boolean
          is_required?: boolean
          label: string
          notes?: string | null
          owner?: string
          purchase_file_id: string
          sort_order?: number
          status?: Database["public"]["Enums"]["pf_settlement_task_status"]
          task_key: Database["public"]["Enums"]["pf_settlement_task_key"]
          updated_at?: string
        }
        Update: {
          blocked_reason?: string | null
          client_id?: string
          completed_at?: string | null
          completed_by_finance_user_id?: string | null
          completed_by_team_user_id?: string | null
          created_at?: string
          created_by_finance_user_id?: string | null
          created_by_team_user_id?: string | null
          description?: string | null
          due_date?: string | null
          due_offset_days?: number | null
          id?: string
          is_auto_seeded?: boolean
          is_required?: boolean
          label?: string
          notes?: string | null
          owner?: string
          purchase_file_id?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["pf_settlement_task_status"]
          task_key?: Database["public"]["Enums"]["pf_settlement_task_key"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_file_settlement_tasks_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_settlement_tasks_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      purchase_file_status_history: {
        Row: {
          actor_id: string | null
          actor_kind: string | null
          created_at: string
          event_type: string
          from_value: string | null
          id: string
          payload: Json | null
          purchase_file_id: string
          to_value: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_kind?: string | null
          created_at?: string
          event_type: string
          from_value?: string | null
          id?: string
          payload?: Json | null
          purchase_file_id: string
          to_value?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_kind?: string | null
          created_at?: string
          event_type?: string
          from_value?: string | null
          id?: string
          payload?: Json | null
          purchase_file_id?: string
          to_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_file_status_history_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_status_history_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      purchase_file_valuations: {
        Row: {
          access_required: string | null
          agent_contact: string | null
          client_id: string
          contract_price: number | null
          created_at: string
          created_by_finance_user_id: string | null
          created_by_team_user_id: string | null
          document_id: string | null
          id: string
          inspected_date: string | null
          lender_submission_id: string | null
          next_action: string | null
          notes: string | null
          ordered_date: string | null
          purchase_file_id: string
          result: Database["public"]["Enums"]["valuation_result"]
          returned_date: string | null
          risk_level: string | null
          shortfall: number | null
          status: Database["public"]["Enums"]["valuation_status"]
          updated_at: string
          valuation_amount: number | null
          valuer: string | null
        }
        Insert: {
          access_required?: string | null
          agent_contact?: string | null
          client_id: string
          contract_price?: number | null
          created_at?: string
          created_by_finance_user_id?: string | null
          created_by_team_user_id?: string | null
          document_id?: string | null
          id?: string
          inspected_date?: string | null
          lender_submission_id?: string | null
          next_action?: string | null
          notes?: string | null
          ordered_date?: string | null
          purchase_file_id: string
          result?: Database["public"]["Enums"]["valuation_result"]
          returned_date?: string | null
          risk_level?: string | null
          shortfall?: number | null
          status?: Database["public"]["Enums"]["valuation_status"]
          updated_at?: string
          valuation_amount?: number | null
          valuer?: string | null
        }
        Update: {
          access_required?: string | null
          agent_contact?: string | null
          client_id?: string
          contract_price?: number | null
          created_at?: string
          created_by_finance_user_id?: string | null
          created_by_team_user_id?: string | null
          document_id?: string | null
          id?: string
          inspected_date?: string | null
          lender_submission_id?: string | null
          next_action?: string | null
          notes?: string | null
          ordered_date?: string | null
          purchase_file_id?: string
          result?: Database["public"]["Enums"]["valuation_result"]
          returned_date?: string | null
          risk_level?: string | null
          shortfall?: number | null
          status?: Database["public"]["Enums"]["valuation_status"]
          updated_at?: string
          valuation_amount?: number | null
          valuer?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_file_valuations_created_by_finance_user_id_fkey"
            columns: ["created_by_finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_valuations_created_by_team_user_id_fkey"
            columns: ["created_by_team_user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_valuations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_valuations_lender_submission_id_fkey"
            columns: ["lender_submission_id"]
            isOneToOne: false
            referencedRelation: "lender_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_valuations_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "purchase_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_file_valuations_purchase_file_id_fkey"
            columns: ["purchase_file_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["purchase_file_id"]
          },
        ]
      }
      purchase_file_voi_verifications: {
        Row: {
          applicant_id: string | null
          client_id: string | null
          completed_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          id_documents: Json
          initiated_by: string | null
          notes: string | null
          provider: string
          provider_ref: string | null
          purchase_file_id: string
          result: Json
          selfie_match: boolean | null
          status: string
          updated_at: string
          verification_url: string | null
        }
        Insert: {
          applicant_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          id_documents?: Json
          initiated_by?: string | null
          notes?: string | null
          provider?: string
          provider_ref?: string | null
          purchase_file_id: string
          result?: Json
          selfie_match?: boolean | null
          status?: string
          updated_at?: string
          verification_url?: string | null
        }
        Update: {
          applicant_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          id_documents?: Json
          initiated_by?: string | null
          notes?: string | null
          provider?: string
          provider_ref?: string | null
          purchase_file_id?: string
          result?: Json
          selfie_match?: boolean | null
          status?: string
          updated_at?: string
          verification_url?: string | null
        }
        Relationships: []
      }
      purchase_files: {
        Row: {
          archived_at: string | null
          assigned_finance_user_id: string | null
          assigned_team_user_id: string | null
          borrowing_snapshot: Json
          borrowing_snapshot_updated_at: string | null
          borrowing_snapshot_updated_by_finance_user_id: string | null
          build_price: number | null
          client_contribution: number | null
          client_deal_id: string | null
          client_id: string
          commercial_loan_type: string | null
          construction_completion_estimate: string | null
          construction_stage: string | null
          construction_start_date: string | null
          created_at: string
          created_by: string | null
          deal_type_fields: Json
          deposit_amount: number | null
          estimated_rent_weekly: number | null
          finance_clause_date: string | null
          finance_status: Database["public"]["Enums"]["purchase_finance_status"]
          gst_treatment: string | null
          id: string
          kanban_position: number | null
          land_price: number | null
          land_settlement_date: string | null
          last_partner_action_at: string | null
          lease_in_place: boolean | null
          lease_term_months: number | null
          lender: string | null
          max_approved_budget: number | null
          net_rental_yield: number | null
          notes: string | null
          property_address: string | null
          property_postcode: string | null
          property_state: string | null
          property_suburb: string | null
          purchase_price: number | null
          purchase_type: Database["public"]["Enums"]["purchase_file_type"]
          risk_level: string | null
          settlement_date: string | null
          status: Database["public"]["Enums"]["purchase_file_status"]
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assigned_finance_user_id?: string | null
          assigned_team_user_id?: string | null
          borrowing_snapshot?: Json
          borrowing_snapshot_updated_at?: string | null
          borrowing_snapshot_updated_by_finance_user_id?: string | null
          build_price?: number | null
          client_contribution?: number | null
          client_deal_id?: string | null
          client_id: string
          commercial_loan_type?: string | null
          construction_completion_estimate?: string | null
          construction_stage?: string | null
          construction_start_date?: string | null
          created_at?: string
          created_by?: string | null
          deal_type_fields?: Json
          deposit_amount?: number | null
          estimated_rent_weekly?: number | null
          finance_clause_date?: string | null
          finance_status?: Database["public"]["Enums"]["purchase_finance_status"]
          gst_treatment?: string | null
          id?: string
          kanban_position?: number | null
          land_price?: number | null
          land_settlement_date?: string | null
          last_partner_action_at?: string | null
          lease_in_place?: boolean | null
          lease_term_months?: number | null
          lender?: string | null
          max_approved_budget?: number | null
          net_rental_yield?: number | null
          notes?: string | null
          property_address?: string | null
          property_postcode?: string | null
          property_state?: string | null
          property_suburb?: string | null
          purchase_price?: number | null
          purchase_type?: Database["public"]["Enums"]["purchase_file_type"]
          risk_level?: string | null
          settlement_date?: string | null
          status?: Database["public"]["Enums"]["purchase_file_status"]
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assigned_finance_user_id?: string | null
          assigned_team_user_id?: string | null
          borrowing_snapshot?: Json
          borrowing_snapshot_updated_at?: string | null
          borrowing_snapshot_updated_by_finance_user_id?: string | null
          build_price?: number | null
          client_contribution?: number | null
          client_deal_id?: string | null
          client_id?: string
          commercial_loan_type?: string | null
          construction_completion_estimate?: string | null
          construction_stage?: string | null
          construction_start_date?: string | null
          created_at?: string
          created_by?: string | null
          deal_type_fields?: Json
          deposit_amount?: number | null
          estimated_rent_weekly?: number | null
          finance_clause_date?: string | null
          finance_status?: Database["public"]["Enums"]["purchase_finance_status"]
          gst_treatment?: string | null
          id?: string
          kanban_position?: number | null
          land_price?: number | null
          land_settlement_date?: string | null
          last_partner_action_at?: string | null
          lease_in_place?: boolean | null
          lease_term_months?: number | null
          lender?: string | null
          max_approved_budget?: number | null
          net_rental_yield?: number | null
          notes?: string | null
          property_address?: string | null
          property_postcode?: string | null
          property_state?: string | null
          property_suburb?: string | null
          purchase_price?: number | null
          purchase_type?: Database["public"]["Enums"]["purchase_file_type"]
          risk_level?: string | null
          settlement_date?: string | null
          status?: Database["public"]["Enums"]["purchase_file_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_files_assigned_finance_user_id_fkey"
            columns: ["assigned_finance_user_id"]
            isOneToOne: false
            referencedRelation: "finance_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_files_assigned_team_user_id_fkey"
            columns: ["assigned_team_user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_files_client_deal_id_fkey"
            columns: ["client_deal_id"]
            isOneToOne: false
            referencedRelation: "client_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_files_client_deal_id_fkey"
            columns: ["client_deal_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_file_deal_drift"
            referencedColumns: ["client_deal_id"]
          },
          {
            foreignKeyName: "purchase_files_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      push_delivery_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          notification_id: string | null
          payload_title: string | null
          status: string
          status_code: number | null
          subscription_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          notification_id?: string | null
          payload_title?: string | null
          status: string
          status_code?: number | null
          subscription_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          notification_id?: string | null
          payload_title?: string | null
          status?: string
          status_code?: number | null
          subscription_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_delivery_log_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_delivery_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          device_label: string | null
          endpoint: string
          id: string
          is_active: boolean
          last_seen_at: string
          p256dh: string
          subscriber_type: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          device_label?: string | null
          endpoint: string
          id?: string
          is_active?: boolean
          last_seen_at?: string
          p256dh: string
          subscriber_type?: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          device_label?: string | null
          endpoint?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string
          p256dh?: string
          subscriber_type?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      report_engine_audit: {
        Row: {
          after_value: Json | null
          before_value: Json | null
          created_at: string
          id: string
          performed_at: string
          performed_by: string | null
          proposal_id: string | null
          rationale: string | null
          target_id: string | null
          target_kind: string
        }
        Insert: {
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          id?: string
          performed_at?: string
          performed_by?: string | null
          proposal_id?: string | null
          rationale?: string | null
          target_id?: string | null
          target_kind: string
        }
        Update: {
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          id?: string
          performed_at?: string
          performed_by?: string | null
          proposal_id?: string | null
          rationale?: string | null
          target_id?: string | null
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_engine_audit_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "report_engine_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      report_engine_config: {
        Row: {
          config_key: string
          created_at: string
          description: string | null
          id: string
          scope: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          config_key: string
          created_at?: string
          description?: string | null
          id?: string
          scope?: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          config_key?: string
          created_at?: string
          description?: string | null
          id?: string
          scope?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      report_engine_proposals: {
        Row: {
          after_value: Json | null
          applied_at: string | null
          applied_by_user: string | null
          before_value: Json | null
          conversation_id: string | null
          created_at: string
          id: string
          patch: Json | null
          proposed_by_agent: boolean
          proposed_by_user: string | null
          rationale: string | null
          rejected_at: string | null
          rejection_reason: string | null
          status: string
          target_id: string | null
          target_kind: string
          updated_at: string
        }
        Insert: {
          after_value?: Json | null
          applied_at?: string | null
          applied_by_user?: string | null
          before_value?: Json | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          patch?: Json | null
          proposed_by_agent?: boolean
          proposed_by_user?: string | null
          rationale?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          status?: string
          target_id?: string | null
          target_kind: string
          updated_at?: string
        }
        Update: {
          after_value?: Json | null
          applied_at?: string | null
          applied_by_user?: string | null
          before_value?: Json | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          patch?: Json | null
          proposed_by_agent?: boolean
          proposed_by_user?: string | null
          rationale?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          status?: string
          target_id?: string | null
          target_kind?: string
          updated_at?: string
        }
        Relationships: []
      }
      report_generation_chunks: {
        Row: {
          attached_packet_keys: string[]
          attached_template_chunk_ids: Json
          completion_tokens: number
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          latency_ms: number | null
          model: string | null
          ordinal: number
          phase: string | null
          prompt_tokens: number
          response: string | null
          response_size_bytes: number | null
          retrieval_meta: Json | null
          retry_count: number
          run_id: string
          section_key: string
          section_label: string | null
          started_at: string
          status: string
          system_prompt: string | null
          tool_calls: Json | null
          user_prompt: string | null
          user_prompt_size_bytes: number | null
        }
        Insert: {
          attached_packet_keys?: string[]
          attached_template_chunk_ids?: Json
          completion_tokens?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          ordinal?: number
          phase?: string | null
          prompt_tokens?: number
          response?: string | null
          response_size_bytes?: number | null
          retrieval_meta?: Json | null
          retry_count?: number
          run_id: string
          section_key: string
          section_label?: string | null
          started_at?: string
          status?: string
          system_prompt?: string | null
          tool_calls?: Json | null
          user_prompt?: string | null
          user_prompt_size_bytes?: number | null
        }
        Update: {
          attached_packet_keys?: string[]
          attached_template_chunk_ids?: Json
          completion_tokens?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          ordinal?: number
          phase?: string | null
          prompt_tokens?: number
          response?: string | null
          response_size_bytes?: number | null
          retrieval_meta?: Json | null
          retry_count?: number
          run_id?: string
          section_key?: string
          section_label?: string | null
          started_at?: string
          status?: string
          system_prompt?: string | null
          tool_calls?: Json | null
          user_prompt?: string | null
          user_prompt_size_bytes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "report_generation_chunks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "report_generation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      report_generation_preferences: {
        Row: {
          created_at: string
          default_scope: string
          default_tier: string
          last_used_at: string | null
          last_used_scope: string | null
          last_used_tier: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_scope?: string
          default_tier?: string
          last_used_at?: string | null
          last_used_scope?: string | null
          last_used_tier?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_scope?: string
          default_tier?: string
          last_used_at?: string | null
          last_used_scope?: string | null
          last_used_tier?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      report_generation_runs: {
        Row: {
          created_at: string
          data_packet: Json | null
          data_packet_hash: string | null
          data_packet_size_bytes: number | null
          engine_version: string | null
          error: string | null
          finished_at: string | null
          id: string
          initiated_by: string | null
          model: string | null
          registry_snapshot: Json | null
          report_id: string | null
          scope: string | null
          started_at: string
          status: string
          system_prompt: string | null
          template_ids: Json
          total_completion_tokens: number
          total_cost_cents: number
          total_prompt_tokens: number
          trigger_source: string | null
          variant: string | null
        }
        Insert: {
          created_at?: string
          data_packet?: Json | null
          data_packet_hash?: string | null
          data_packet_size_bytes?: number | null
          engine_version?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          initiated_by?: string | null
          model?: string | null
          registry_snapshot?: Json | null
          report_id?: string | null
          scope?: string | null
          started_at?: string
          status?: string
          system_prompt?: string | null
          template_ids?: Json
          total_completion_tokens?: number
          total_cost_cents?: number
          total_prompt_tokens?: number
          trigger_source?: string | null
          variant?: string | null
        }
        Update: {
          created_at?: string
          data_packet?: Json | null
          data_packet_hash?: string | null
          data_packet_size_bytes?: number | null
          engine_version?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          initiated_by?: string | null
          model?: string | null
          registry_snapshot?: Json | null
          report_id?: string | null
          scope?: string | null
          started_at?: string
          status?: string
          system_prompt?: string | null
          template_ids?: Json
          total_completion_tokens?: number
          total_cost_cents?: number
          total_prompt_tokens?: number
          trigger_source?: string | null
          variant?: string | null
        }
        Relationships: []
      }
      report_hero_placements: {
        Row: {
          created_at: string
          focal: string
          id: string
          library_image_id: string
          object_fit: string
          position_order: number
          render_height: string
          render_width: string
          report_id: string
          rounded: boolean
          section_key: string
          section_title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          focal?: string
          id?: string
          library_image_id: string
          object_fit?: string
          position_order?: number
          render_height?: string
          render_width?: string
          report_id: string
          rounded?: boolean
          section_key: string
          section_title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          focal?: string
          id?: string
          library_image_id?: string
          object_fit?: string
          position_order?: number
          render_height?: string
          render_width?: string
          report_id?: string
          rounded?: boolean
          section_key?: string
          section_title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_hero_placements_library_image_id_fkey"
            columns: ["library_image_id"]
            isOneToOne: false
            referencedRelation: "hero_image_library"
            referencedColumns: ["id"]
          },
        ]
      }
      report_qa_conversation_shares: {
        Row: {
          conversation_id: string
          created_at: string
          handoff_note: string | null
          id: string
          is_active: boolean
          permission: string
          shared_by: string
          shared_with: string
          updated_at: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          handoff_note?: string | null
          id?: string
          is_active?: boolean
          permission?: string
          shared_by: string
          shared_with: string
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          handoff_note?: string | null
          id?: string
          is_active?: boolean
          permission?: string
          shared_by?: string
          shared_with?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_qa_conversation_shares_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "report_qa_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_qa_conversation_shares_shared_by_fkey"
            columns: ["shared_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_qa_conversation_shares_shared_with_fkey"
            columns: ["shared_with"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      report_qa_conversations: {
        Row: {
          agent_mode: boolean
          branched_from_conversation_id: string | null
          branched_from_message_id: string | null
          client_id: string | null
          conversation_summary: string | null
          created_at: string
          created_by: string | null
          id: string
          last_summarized_at: string | null
          report_contents: string[]
          report_names: string[]
          status: string
          structured_report: string | null
          summary_message_count: number | null
          title: string | null
          updated_at: string
        }
        Insert: {
          agent_mode?: boolean
          branched_from_conversation_id?: string | null
          branched_from_message_id?: string | null
          client_id?: string | null
          conversation_summary?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_summarized_at?: string | null
          report_contents?: string[]
          report_names?: string[]
          status?: string
          structured_report?: string | null
          summary_message_count?: number | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          agent_mode?: boolean
          branched_from_conversation_id?: string | null
          branched_from_message_id?: string | null
          client_id?: string | null
          conversation_summary?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_summarized_at?: string | null
          report_contents?: string[]
          report_names?: string[]
          status?: string
          structured_report?: string | null
          summary_message_count?: number | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_qa_conversations_branched_from_conversation_id_fkey"
            columns: ["branched_from_conversation_id"]
            isOneToOne: false
            referencedRelation: "report_qa_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_qa_conversations_branched_from_message_id_fkey"
            columns: ["branched_from_message_id"]
            isOneToOne: false
            referencedRelation: "report_qa_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_qa_conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      report_qa_message_feedback: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          message_id: string
          rating: number
          reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          message_id: string
          rating: number
          reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          message_id?: string
          rating?: number
          reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_qa_message_feedback_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "report_qa_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_qa_message_feedback_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "report_qa_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      report_qa_messages: {
        Row: {
          attachments: Json | null
          branched_from_message_id: string | null
          citations: Json | null
          comparison_mode: boolean
          content: string
          conversation_id: string
          created_at: string
          edited_content: string | null
          id: string
          model_provider: string | null
          model_version: string | null
          pinned: boolean
          prompt_version: string | null
          role: string
          sent_by: string | null
          sent_by_username: string | null
          share_expires_at: string | null
          share_last_accessed_at: string | null
          share_revoked_at: string | null
          share_token: string | null
          share_token_hash: string | null
          share_token_prefix: string | null
          share_view_count: number
          stream_id: string | null
          tool_invocations: Json
        }
        Insert: {
          attachments?: Json | null
          branched_from_message_id?: string | null
          citations?: Json | null
          comparison_mode?: boolean
          content: string
          conversation_id: string
          created_at?: string
          edited_content?: string | null
          id?: string
          model_provider?: string | null
          model_version?: string | null
          pinned?: boolean
          prompt_version?: string | null
          role: string
          sent_by?: string | null
          sent_by_username?: string | null
          share_expires_at?: string | null
          share_last_accessed_at?: string | null
          share_revoked_at?: string | null
          share_token?: string | null
          share_token_hash?: string | null
          share_token_prefix?: string | null
          share_view_count?: number
          stream_id?: string | null
          tool_invocations?: Json
        }
        Update: {
          attachments?: Json | null
          branched_from_message_id?: string | null
          citations?: Json | null
          comparison_mode?: boolean
          content?: string
          conversation_id?: string
          created_at?: string
          edited_content?: string | null
          id?: string
          model_provider?: string | null
          model_version?: string | null
          pinned?: boolean
          prompt_version?: string | null
          role?: string
          sent_by?: string | null
          sent_by_username?: string | null
          share_expires_at?: string | null
          share_last_accessed_at?: string | null
          share_revoked_at?: string | null
          share_token?: string | null
          share_token_hash?: string | null
          share_token_prefix?: string | null
          share_view_count?: number
          stream_id?: string | null
          tool_invocations?: Json
        }
        Relationships: [
          {
            foreignKeyName: "report_qa_messages_branched_from_message_id_fkey"
            columns: ["branched_from_message_id"]
            isOneToOne: false
            referencedRelation: "report_qa_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_qa_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "report_qa_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_qa_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      report_qa_share_access_log: {
        Row: {
          created_at: string
          id: string
          message_id: string | null
          outcome: string
          requester_ip: string | null
          requester_ua: string | null
          share_token_prefix: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id?: string | null
          outcome: string
          requester_ip?: string | null
          requester_ua?: string | null
          share_token_prefix: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string | null
          outcome?: string
          requester_ip?: string | null
          requester_ua?: string | null
          share_token_prefix?: string
        }
        Relationships: []
      }
      report_qa_stream_checkpoints: {
        Row: {
          citations: Json | null
          comparison_mode: boolean
          conversation_id: string | null
          created_at: string
          error_message: string | null
          id: string
          last_event_at: string
          model_provider: string | null
          partial_content: string
          question: string | null
          status: string
          stream_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          citations?: Json | null
          comparison_mode?: boolean
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          last_event_at?: string
          model_provider?: string | null
          partial_content?: string
          question?: string | null
          status?: string
          stream_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          citations?: Json | null
          comparison_mode?: boolean
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          last_event_at?: string
          model_provider?: string | null
          partial_content?: string
          question?: string | null
          status?: string
          stream_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      report_structure_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          is_active: boolean | null
          metadata: Json | null
          mime_type: string | null
          name: string
          parsed_content: string | null
          priority: number | null
          report_category:
            | Database["public"]["Enums"]["report_category_enum"]
            | null
          report_tier: Database["public"]["Enums"]["report_tier_enum"] | null
          template_type: Database["public"]["Enums"]["template_type"]
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          mime_type?: string | null
          name: string
          parsed_content?: string | null
          priority?: number | null
          report_category?:
            | Database["public"]["Enums"]["report_category_enum"]
            | null
          report_tier?: Database["public"]["Enums"]["report_tier_enum"] | null
          template_type: Database["public"]["Enums"]["template_type"]
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          mime_type?: string | null
          name?: string
          parsed_content?: string | null
          priority?: number | null
          report_category?:
            | Database["public"]["Enums"]["report_category_enum"]
            | null
          report_tier?: Database["public"]["Enums"]["report_tier_enum"] | null
          template_type?: Database["public"]["Enums"]["template_type"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_structure_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      report_template_versions: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_name: string | null
          id: string
          label: string | null
          note: string | null
          schema: Json
          template_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          label?: string | null
          note?: string | null
          schema: Json
          template_id: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          label?: string | null
          note?: string | null
          schema?: Json
          template_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "report_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      report_templates: {
        Row: {
          active_theme: string
          agency_id: string | null
          approval_status: string
          branch_label: string | null
          brand_kit_id: string | null
          config: Json
          created_at: string
          created_by: string | null
          custom_css: string | null
          description: string | null
          engine: string
          id: string
          is_active: boolean
          is_default: boolean | null
          is_draft: boolean
          locked_at: string | null
          locked_by: string | null
          locked_for_review: boolean
          name: string
          owner_user_id: string | null
          parent_template_id: string | null
          priority: number
          report_type: string | null
          schema: Json
          scope: string
          thumbnail_url: string | null
          tier: string | null
          updated_at: string
          variant: string | null
          version: number
        }
        Insert: {
          active_theme?: string
          agency_id?: string | null
          approval_status?: string
          branch_label?: string | null
          brand_kit_id?: string | null
          config: Json
          created_at?: string
          created_by?: string | null
          custom_css?: string | null
          description?: string | null
          engine?: string
          id?: string
          is_active?: boolean
          is_default?: boolean | null
          is_draft?: boolean
          locked_at?: string | null
          locked_by?: string | null
          locked_for_review?: boolean
          name: string
          owner_user_id?: string | null
          parent_template_id?: string | null
          priority?: number
          report_type?: string | null
          schema?: Json
          scope?: string
          thumbnail_url?: string | null
          tier?: string | null
          updated_at?: string
          variant?: string | null
          version?: number
        }
        Update: {
          active_theme?: string
          agency_id?: string | null
          approval_status?: string
          branch_label?: string | null
          brand_kit_id?: string | null
          config?: Json
          created_at?: string
          created_by?: string | null
          custom_css?: string | null
          description?: string | null
          engine?: string
          id?: string
          is_active?: boolean
          is_default?: boolean | null
          is_draft?: boolean
          locked_at?: string | null
          locked_by?: string | null
          locked_for_review?: boolean
          name?: string
          owner_user_id?: string | null
          parent_template_id?: string | null
          priority?: number
          report_type?: string | null
          schema?: Json
          scope?: string
          thumbnail_url?: string | null
          tier?: string | null
          updated_at?: string
          variant?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "report_templates_brand_kit_id_fkey"
            columns: ["brand_kit_id"]
            isOneToOne: false
            referencedRelation: "brand_kits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_templates_parent_template_id_fkey"
            columns: ["parent_template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      report_versions: {
        Row: {
          calculation_version: string | null
          changelog: string | null
          created_at: string | null
          created_by: string | null
          data_sources: Json | null
          demographics_data: Json | null
          economic_data: Json | null
          financial_calculations: Json | null
          id: string
          investment_score: Json | null
          location_intelligence: Json | null
          property_specs: Json | null
          quality_score: number | null
          report_content: string
          report_id: string
          sources_content: string | null
          validation_flags: Json | null
          version_number: number
        }
        Insert: {
          calculation_version?: string | null
          changelog?: string | null
          created_at?: string | null
          created_by?: string | null
          data_sources?: Json | null
          demographics_data?: Json | null
          economic_data?: Json | null
          financial_calculations?: Json | null
          id?: string
          investment_score?: Json | null
          location_intelligence?: Json | null
          property_specs?: Json | null
          quality_score?: number | null
          report_content: string
          report_id: string
          sources_content?: string | null
          validation_flags?: Json | null
          version_number: number
        }
        Update: {
          calculation_version?: string | null
          changelog?: string | null
          created_at?: string | null
          created_by?: string | null
          data_sources?: Json | null
          demographics_data?: Json | null
          economic_data?: Json | null
          financial_calculations?: Json | null
          id?: string
          investment_score?: Json | null
          location_intelligence?: Json | null
          property_specs?: Json | null
          quality_score?: number | null
          report_content?: string
          report_id?: string
          sources_content?: string | null
          validation_flags?: Json | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "report_versions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "investment_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_visual_assets: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          id: string
          include_in_report: boolean
          prompt_hash: string
          public_url: string | null
          report_id: string
          section_key: string
          section_title: string
          status: string
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          include_in_report?: boolean
          prompt_hash: string
          public_url?: string | null
          report_id: string
          section_key: string
          section_title: string
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          include_in_report?: boolean
          prompt_hash?: string
          public_url?: string | null
          report_id?: string
          section_key?: string
          section_title?: string
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      risk_assessment_cache: {
        Row: {
          bushfire_risk: Json | null
          created_at: string
          data_quality: string
          expires_at: string
          fetched_at: string
          flood_risk: Json | null
          id: string
          latitude: number | null
          longitude: number | null
          postcode: string
          state: string
          suburb: string
        }
        Insert: {
          bushfire_risk?: Json | null
          created_at?: string
          data_quality?: string
          expires_at?: string
          fetched_at?: string
          flood_risk?: Json | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          postcode: string
          state: string
          suburb: string
        }
        Update: {
          bushfire_risk?: Json | null
          created_at?: string
          data_quality?: string
          expires_at?: string
          fetched_at?: string
          flood_risk?: Json | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          postcode?: string
          state?: string
          suburb?: string
        }
        Relationships: []
      }
      schools_directory: {
        Row: {
          address: string | null
          created_at: string
          icsea_score: number | null
          id: string
          last_updated: string | null
          latitude: number | null
          longitude: number | null
          name: string
          naplan_data: Json | null
          postcode: string
          school_level: string | null
          school_type: string | null
          state: string
          student_count: number | null
          suburb: string
          website_url: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          icsea_score?: number | null
          id?: string
          last_updated?: string | null
          latitude?: number | null
          longitude?: number | null
          name: string
          naplan_data?: Json | null
          postcode: string
          school_level?: string | null
          school_type?: string | null
          state: string
          student_count?: number | null
          suburb: string
          website_url?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          icsea_score?: number | null
          id?: string
          last_updated?: string | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          naplan_data?: Json | null
          postcode?: string
          school_level?: string | null
          school_type?: string | null
          state?: string
          student_count?: number | null
          suburb?: string
          website_url?: string | null
        }
        Relationships: []
      }
      security_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          correlation_id: string | null
          decision: string
          id: string
          metadata_redacted: Json
          occurred_at: string
          reason_code: string | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type?: string
          correlation_id?: string | null
          decision: string
          id?: string
          metadata_redacted?: Json
          occurred_at?: string
          reason_code?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          correlation_id?: string | null
          decision?: string
          id?: string
          metadata_redacted?: Json
          occurred_at?: string
          reason_code?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      stamp_duty_rates_cache: {
        Row: {
          brackets: Json
          created_at: string
          data_quality: string
          expires_at: string
          fetched_at: string
          id: string
          source_url: string | null
          state: string
          updated_at: string
        }
        Insert: {
          brackets: Json
          created_at?: string
          data_quality?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          source_url?: string | null
          state: string
          updated_at?: string
        }
        Update: {
          brackets?: Json
          created_at?: string
          data_quality?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          source_url?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      step_up_sessions: {
        Row: {
          assurance_level: number
          capability: string
          created_at: string
          expires_at: string
          id: string
          ip_address: string | null
          issued_at: string
          method: string
          revoked_at: string | null
          token_hash: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          assurance_level?: number
          capability: string
          created_at?: string
          expires_at: string
          id?: string
          ip_address?: string | null
          issued_at?: string
          method?: string
          revoked_at?: string | null
          token_hash: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          assurance_level?: number
          capability?: string
          created_at?: string
          expires_at?: string
          id?: string
          ip_address?: string | null
          issued_at?: string
          method?: string
          revoked_at?: string | null
          token_hash?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      storage_object_bindings: {
        Row: {
          bucket: string
          client_id: string | null
          created_at: string
          created_by: string | null
          id: string
          object_path: string
          owner_user_id: string | null
          resource_id: string | null
          resource_type: string
          sensitivity: string
        }
        Insert: {
          bucket: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          object_path: string
          owner_user_id?: string | null
          resource_id?: string | null
          resource_type: string
          sensitivity?: string
        }
        Update: {
          bucket?: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          object_path?: string
          owner_user_id?: string | null
          resource_id?: string | null
          resource_type?: string
          sensitivity?: string
        }
        Relationships: []
      }
      suburb_directory: {
        Row: {
          created_at: string
          id: string
          postcode: string
          state: string
          suburb: string
        }
        Insert: {
          created_at?: string
          id?: string
          postcode: string
          state: string
          suburb: string
        }
        Update: {
          created_at?: string
          id?: string
          postcode?: string
          state?: string
          suburb?: string
        }
        Relationships: []
      }
      system_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          id: string
          kind: string
          message: string
          payload: Json | null
          severity: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          kind: string
          message: string
          payload?: Json | null
          severity?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          kind?: string
          message?: string
          payload?: Json | null
          severity?: string
        }
        Relationships: []
      }
      template_approvals: {
        Row: {
          created_at: string
          decided_at: string | null
          decision_note: string | null
          id: string
          note: string | null
          requested_by: string | null
          requested_by_name: string | null
          reviewer_id: string | null
          reviewer_name: string | null
          status: string
          template_id: string
          updated_at: string
          version: number | null
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          id?: string
          note?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          reviewer_id?: string | null
          reviewer_name?: string | null
          status?: string
          template_id: string
          updated_at?: string
          version?: number | null
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          id?: string
          note?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          reviewer_id?: string | null
          reviewer_name?: string | null
          status?: string
          template_id?: string
          updated_at?: string
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "template_approvals_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      template_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          created_at: string
          id: string
          metadata: Json
          summary: string | null
          template_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          summary?: string | null
          template_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          summary?: string | null
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_audit_log_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      template_comments: {
        Row: {
          author_id: string | null
          author_name: string | null
          block_id: string | null
          body: string
          created_at: string
          id: string
          metadata: Json
          overlay_id: string | null
          page_id: string | null
          parent_id: string | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          template_id: string
          thread_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          author_name?: string | null
          block_id?: string | null
          body: string
          created_at?: string
          id?: string
          metadata?: Json
          overlay_id?: string | null
          page_id?: string | null
          parent_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          template_id: string
          thread_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          author_name?: string | null
          block_id?: string | null
          body?: string
          created_at?: string
          id?: string
          metadata?: Json
          overlay_id?: string | null
          page_id?: string | null
          parent_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          template_id?: string
          thread_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "template_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      template_components: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          payload: Json
          tags: string[]
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          payload?: Json
          tags?: string[]
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          payload?: Json
          tags?: string[]
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      template_events: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          block_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          page_id: string | null
          share_token: string | null
          template_id: string
          template_version: number | null
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          block_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          page_id?: string | null
          share_token?: string | null
          template_id: string
          template_version?: number | null
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          block_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          page_id?: string | null
          share_token?: string | null
          template_id?: string
          template_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "template_events_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      template_imports: {
        Row: {
          created_at: string
          created_template_id: string | null
          error: string | null
          fidelity_mode: string
          id: string
          meta: Json
          page_count: number | null
          source_filename: string | null
          source_size_bytes: number | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_template_id?: string | null
          error?: string | null
          fidelity_mode?: string
          id?: string
          meta?: Json
          page_count?: number | null
          source_filename?: string | null
          source_size_bytes?: number | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_template_id?: string | null
          error?: string | null
          fidelity_mode?: string
          id?: string
          meta?: Json
          page_count?: number | null
          source_filename?: string | null
          source_size_bytes?: number | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      template_render_jobs: {
        Row: {
          asset_count: number | null
          bytes: number | null
          created_at: string
          duration_ms: number | null
          error: string | null
          file_name: string
          id: string
          metadata: Json
          mode: string
          page_count: number | null
          page_master_id: string | null
          pdf_variant: string
          requested_by: string | null
          signed_url: string | null
          signed_url_expires_at: string | null
          status: string
          storage_path: string | null
          tagged: boolean
          template_id: string | null
          template_name: string | null
          theme_id: string | null
          updated_at: string
        }
        Insert: {
          asset_count?: number | null
          bytes?: number | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          file_name: string
          id?: string
          metadata?: Json
          mode?: string
          page_count?: number | null
          page_master_id?: string | null
          pdf_variant?: string
          requested_by?: string | null
          signed_url?: string | null
          signed_url_expires_at?: string | null
          status?: string
          storage_path?: string | null
          tagged?: boolean
          template_id?: string | null
          template_name?: string | null
          theme_id?: string | null
          updated_at?: string
        }
        Update: {
          asset_count?: number | null
          bytes?: number | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          file_name?: string
          id?: string
          metadata?: Json
          mode?: string
          page_count?: number | null
          page_master_id?: string | null
          pdf_variant?: string
          requested_by?: string | null
          signed_url?: string | null
          signed_url_expires_at?: string | null
          status?: string
          storage_path?: string | null
          tagged?: boolean
          template_id?: string | null
          template_name?: string | null
          theme_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      template_share_links: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          label: string | null
          last_viewed_at: string | null
          mode: string
          revoked_at: string | null
          template_id: string
          theme_id: string | null
          token: string
          updated_at: string
          view_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          last_viewed_at?: string | null
          mode?: string
          revoked_at?: string | null
          template_id: string
          theme_id?: string | null
          token: string
          updated_at?: string
          view_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          last_viewed_at?: string | null
          mode?: string
          revoked_at?: string | null
          template_id?: string
          theme_id?: string | null
          token?: string
          updated_at?: string
          view_count?: number
        }
        Relationships: []
      }
      token_audit_log: {
        Row: {
          agency_ref: string
          available_tokens: number
          billing_user_id: string | null
          created_at: string
          error_message: string | null
          event: string
          function_name: string | null
          id: string
          idempotency_key: string
          job_id: string | null
          kind: string | null
          reason: string | null
          request_payload: Json | null
          requested_tokens: number
          reserved_tokens: number
          status: string | null
          used_tokens: number
          user_id: string | null
        }
        Insert: {
          agency_ref: string
          available_tokens?: number
          billing_user_id?: string | null
          created_at?: string
          error_message?: string | null
          event: string
          function_name?: string | null
          id?: string
          idempotency_key: string
          job_id?: string | null
          kind?: string | null
          reason?: string | null
          request_payload?: Json | null
          requested_tokens?: number
          reserved_tokens?: number
          status?: string | null
          used_tokens?: number
          user_id?: string | null
        }
        Update: {
          agency_ref?: string
          available_tokens?: number
          billing_user_id?: string | null
          created_at?: string
          error_message?: string | null
          event?: string
          function_name?: string | null
          id?: string
          idempotency_key?: string
          job_id?: string | null
          kind?: string | null
          reason?: string | null
          request_payload?: Json | null
          requested_tokens?: number
          reserved_tokens?: number
          status?: string | null
          used_tokens?: number
          user_id?: string | null
        }
        Relationships: []
      }
      token_balance_cache: {
        Row: {
          available: number
          current_period_end: string | null
          lifetime_granted: number
          lifetime_spent: number
          monthly_allowance: number
          plan_name: string | null
          reserved: number
          tenant_ref: string
          updated_at: string
        }
        Insert: {
          available?: number
          current_period_end?: string | null
          lifetime_granted?: number
          lifetime_spent?: number
          monthly_allowance?: number
          plan_name?: string | null
          reserved?: number
          tenant_ref: string
          updated_at?: string
        }
        Update: {
          available?: number
          current_period_end?: string | null
          lifetime_granted?: number
          lifetime_spent?: number
          monthly_allowance?: number
          plan_name?: string | null
          reserved?: number
          tenant_ref?: string
          updated_at?: string
        }
        Relationships: []
      }
      token_usage_history: {
        Row: {
          actual_tokens: number
          agency_ref: string
          billing_user_id: string | null
          created_at: string
          duration_ms: number
          error_message: string | null
          estimated_tokens: number
          function_name: string
          id: string
          idempotency_key: string
          job_id: string | null
          kind: string
          request_payload: Json | null
          reserved_tokens: number
          status: string
          user_id: string | null
        }
        Insert: {
          actual_tokens?: number
          agency_ref: string
          billing_user_id?: string | null
          created_at?: string
          duration_ms?: number
          error_message?: string | null
          estimated_tokens?: number
          function_name: string
          id?: string
          idempotency_key: string
          job_id?: string | null
          kind: string
          request_payload?: Json | null
          reserved_tokens?: number
          status?: string
          user_id?: string | null
        }
        Update: {
          actual_tokens?: number
          agency_ref?: string
          billing_user_id?: string | null
          created_at?: string
          duration_ms?: number
          error_message?: string | null
          estimated_tokens?: number
          function_name?: string
          id?: string
          idempotency_key?: string
          job_id?: string | null
          kind?: string
          request_payload?: Json | null
          reserved_tokens?: number
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      token_webhook_events: {
        Row: {
          event: string
          id: string
          payload: Json | null
          received_at: string
        }
        Insert: {
          event: string
          id: string
          payload?: Json | null
          received_at?: string
        }
        Update: {
          event?: string
          id?: string
          payload?: Json | null
          received_at?: string
        }
        Relationships: []
      }
      transport_data_cache: {
        Row: {
          created_at: string
          data: Json
          data_quality: string
          expires_at: string
          fetched_at: string
          id: string
          latitude: number
          longitude: number
          state: string
          suburb: string | null
        }
        Insert: {
          created_at?: string
          data: Json
          data_quality?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          latitude: number
          longitude: number
          state: string
          suburb?: string | null
        }
        Update: {
          created_at?: string
          data?: Json
          data_quality?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          latitude?: number
          longitude?: number
          state?: string
          suburb?: string | null
        }
        Relationships: []
      }
      user_permissions: {
        Row: {
          can_delete: boolean
          can_edit: boolean
          can_view: boolean
          created_at: string
          granted_by: string | null
          id: string
          module_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          can_delete?: boolean
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          granted_by?: string | null
          id?: string
          module_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          can_delete?: boolean
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          granted_by?: string | null
          id?: string
          module_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_permissions_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "dashboard_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          author_name: string | null
          brand_colors: Json | null
          chart_preferences: Json | null
          company_name: string | null
          created_at: string
          default_template_id: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          author_name?: string | null
          brand_colors?: Json | null
          chart_preferences?: Json | null
          company_name?: string | null
          created_at?: string
          default_template_id?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          author_name?: string | null
          brand_colors?: Json | null
          chart_preferences?: Json | null
          company_name?: string | null
          created_at?: string
          default_template_id?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_default_template_id_fkey"
            columns: ["default_template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          idle_expires_at: string | null
          ip_address: string | null
          last_used_at: string | null
          portal_scope: string
          revocation_reason: string | null
          revoked_at: string | null
          rotated_from_session_id: string | null
          session_token: string | null
          token_hash: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          idle_expires_at?: string | null
          ip_address?: string | null
          last_used_at?: string | null
          portal_scope?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          rotated_from_session_id?: string | null
          session_token?: string | null
          token_hash?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          idle_expires_at?: string | null
          ip_address?: string | null
          last_used_at?: string | null
          portal_scope?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          rotated_from_session_id?: string | null
          session_token?: string | null
          token_hash?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_webauthn_credentials: {
        Row: {
          aaguid: string | null
          backed_up: boolean
          counter: number
          created_at: string
          credential_id: string
          device_name: string | null
          device_type: string | null
          id: string
          last_used_at: string | null
          public_key: string
          transports: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          aaguid?: string | null
          backed_up?: boolean
          counter?: number
          created_at?: string
          credential_id: string
          device_name?: string | null
          device_type?: string | null
          id?: string
          last_used_at?: string | null
          public_key: string
          transports?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          aaguid?: string | null
          backed_up?: boolean
          counter?: number
          created_at?: string
          credential_id?: string
          device_name?: string | null
          device_type?: string | null
          id?: string
          last_used_at?: string | null
          public_key?: string
          transports?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vapi_call_logs: {
        Row: {
          action_items: string[] | null
          agent_id: string | null
          agent_name: string | null
          ai_recommendations: string[] | null
          artifact_messages: Json | null
          assistants_involved: Json | null
          call_direction: string | null
          call_intent: string | null
          call_outcome: string | null
          call_status: string | null
          cost: number | null
          created_at: string
          customer_name: string | null
          duration_seconds: number | null
          ended_at: string | null
          escalation_severity: number | null
          ghl_contact_id: string | null
          handoff_sequence: Json | null
          id: string
          is_squad_call: boolean | null
          key_topics: string[] | null
          metadata: Json | null
          negative_sentiment_moment: Json | null
          phone_number: string | null
          recording_url: string | null
          recovery_priority: number | null
          resolution_notes: string | null
          resolution_status: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          root_cause_category: string | null
          sentiment: string | null
          squad_id: string | null
          squad_name: string | null
          started_at: string | null
          structured_data_multi: Json | null
          summary: string | null
          tags: string[] | null
          transcript: string | null
          updated_at: string
          vapi_call_id: string
        }
        Insert: {
          action_items?: string[] | null
          agent_id?: string | null
          agent_name?: string | null
          ai_recommendations?: string[] | null
          artifact_messages?: Json | null
          assistants_involved?: Json | null
          call_direction?: string | null
          call_intent?: string | null
          call_outcome?: string | null
          call_status?: string | null
          cost?: number | null
          created_at?: string
          customer_name?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          escalation_severity?: number | null
          ghl_contact_id?: string | null
          handoff_sequence?: Json | null
          id?: string
          is_squad_call?: boolean | null
          key_topics?: string[] | null
          metadata?: Json | null
          negative_sentiment_moment?: Json | null
          phone_number?: string | null
          recording_url?: string | null
          recovery_priority?: number | null
          resolution_notes?: string | null
          resolution_status?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          root_cause_category?: string | null
          sentiment?: string | null
          squad_id?: string | null
          squad_name?: string | null
          started_at?: string | null
          structured_data_multi?: Json | null
          summary?: string | null
          tags?: string[] | null
          transcript?: string | null
          updated_at?: string
          vapi_call_id: string
        }
        Update: {
          action_items?: string[] | null
          agent_id?: string | null
          agent_name?: string | null
          ai_recommendations?: string[] | null
          artifact_messages?: Json | null
          assistants_involved?: Json | null
          call_direction?: string | null
          call_intent?: string | null
          call_outcome?: string | null
          call_status?: string | null
          cost?: number | null
          created_at?: string
          customer_name?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          escalation_severity?: number | null
          ghl_contact_id?: string | null
          handoff_sequence?: Json | null
          id?: string
          is_squad_call?: boolean | null
          key_topics?: string[] | null
          metadata?: Json | null
          negative_sentiment_moment?: Json | null
          phone_number?: string | null
          recording_url?: string | null
          recovery_priority?: number | null
          resolution_notes?: string | null
          resolution_status?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          root_cause_category?: string | null
          sentiment?: string | null
          squad_id?: string | null
          squad_name?: string | null
          started_at?: string | null
          structured_data_multi?: Json | null
          summary?: string | null
          tags?: string[] | null
          transcript?: string | null
          updated_at?: string
          vapi_call_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vapi_call_logs_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      whitelabel_settings: {
        Row: {
          accent_color: string | null
          auth_logo: string | null
          company_name: string
          created_at: string
          dark_mode_default: string
          email_signature_address: string | null
          email_signature_banner: string | null
          email_signature_disclaimer: string | null
          email_signature_email: string | null
          email_signature_name: string | null
          email_signature_phone: string | null
          email_signature_title: string | null
          email_signature_website: string | null
          favicon: string | null
          id: string
          logo_config: Json
          primary_color: string | null
          sidebar_icon: string | null
          sidebar_logo: string | null
          theme_config: Json
          theme_version: number
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          auth_logo?: string | null
          company_name?: string
          created_at?: string
          dark_mode_default?: string
          email_signature_address?: string | null
          email_signature_banner?: string | null
          email_signature_disclaimer?: string | null
          email_signature_email?: string | null
          email_signature_name?: string | null
          email_signature_phone?: string | null
          email_signature_title?: string | null
          email_signature_website?: string | null
          favicon?: string | null
          id?: string
          logo_config?: Json
          primary_color?: string | null
          sidebar_icon?: string | null
          sidebar_logo?: string | null
          theme_config?: Json
          theme_version?: number
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          auth_logo?: string | null
          company_name?: string
          created_at?: string
          dark_mode_default?: string
          email_signature_address?: string | null
          email_signature_banner?: string | null
          email_signature_disclaimer?: string | null
          email_signature_email?: string | null
          email_signature_name?: string | null
          email_signature_phone?: string | null
          email_signature_title?: string | null
          email_signature_website?: string | null
          favicon?: string | null
          id?: string
          logo_config?: Json
          primary_color?: string | null
          sidebar_icon?: string | null
          sidebar_logo?: string | null
          theme_config?: Json
          theme_version?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      activity_logs_with_user: {
        Row: {
          action_type:
            | Database["public"]["Enums"]["activity_action_type"]
            | null
          created_at: string | null
          display_username: string | null
          entity_id: string | null
          entity_name: string | null
          entity_type:
            | Database["public"]["Enums"]["activity_entity_type"]
            | null
          id: string | null
          ip_address: string | null
          metadata: Json | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
          user_role: string | null
          username: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "custom_users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portfolio_properties: {
        Row: {
          address: string | null
          asset_class: string | null
          client_id: string | null
          created_at: string | null
          id: string | null
          interest_rate: number | null
          lender_name: string | null
          linked_at: string | null
          loan_remaining: number | null
          monthly_interest_repayment: number | null
          monthly_rental_income: number | null
          noi_pa: number | null
          ownership_percentage: number | null
          source_table: string | null
          sub_type: string | null
          value: number | null
        }
        Relationships: []
      }
      pdf_import_cost_daily: {
        Row: {
          avg_duration_ms: number | null
          avg_ssim_score: number | null
          bytes_in: number | null
          bytes_out: number | null
          cloud_run_ms: number | null
          day: string | null
          engine: string | null
          engine_version: string | null
          failed: number | null
          jobs: number | null
          succeeded: number | null
        }
        Relationships: []
      }
      purchase_file_activity_feed: {
        Row: {
          actor_id: string | null
          actor_kind: string | null
          created_at: string | null
          event_type: string | null
          from_value: string | null
          id: string | null
          payload: Json | null
          purchase_file_id: string | null
          source: string | null
          to_value: string | null
        }
        Relationships: []
      }
      v_purchase_file_deal_drift: {
        Row: {
          address_drift: boolean | null
          client_deal_id: string | null
          client_id: string | null
          deal_address: string | null
          deal_price: number | null
          deal_settlement_date: string | null
          pf_address: string | null
          pf_price: number | null
          pf_settlement_date: string | null
          price_drift: boolean | null
          purchase_file_id: string | null
          settlement_drift: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_files_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_broker_scorecard: {
        Row: {
          approvals: number | null
          avg_days_to_settle: number | null
          broker_id: string | null
          commission_ytd_net: number | null
          settlements: number | null
          total_submissions: number | null
        }
        Relationships: []
      }
      vw_lender_mix: {
        Row: {
          approval_rate_pct: number | null
          approved_count: number | null
          declined_count: number | null
          lender_id: string | null
          lender_name: string | null
          settled_count: number | null
          total_loan_volume: number | null
          total_submissions: number | null
        }
        Relationships: []
      }
      vw_pipeline_funnel: {
        Row: {
          period: string | null
          status: Database["public"]["Enums"]["lender_submission_status"] | null
          submission_count: number | null
          total_loan_amount: number | null
        }
        Relationships: []
      }
      vw_revenue_dashboard: {
        Row: {
          clawback_net: number | null
          entries: number | null
          forecast_net: number | null
          period: string | null
          received_net: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      address_values_match: {
        Args: {
          a_address: string
          a_country: string
          a_postcode: string
          a_state: string
          a_suburb: string
          b_address: string
          b_country: string
          b_postcode: string
          b_state: string
          b_suburb: string
        }
        Returns: boolean
      }
      admin_set_aml_roles_for_user: {
        Args: { _granted_by: string; _roles: string[]; _target_user_id: string }
        Returns: {
          role_name: string
        }[]
      }
      append_migration_upload_chunk: {
        Args: {
          _chunk_index: number
          _expected_rows?: number
          _max_records?: number
          _records: Json
          _upload_id: string
        }
        Returns: {
          id: string
          progress_percent: number
          row_count: number
          status: string
        }[]
      }
      append_migration_upload_records: {
        Args: { _max_records?: number; _records: Json; _upload_id: string }
        Returns: {
          created_at: string
          domain: string
          file_name: string
          id: string
          row_count: number
        }[]
      }
      append_pdf_import_attempt: {
        Args: { p_attempt: Json; p_job_id: string }
        Returns: undefined
      }
      bootstrap_cron_vault: {
        Args: { p_internal_edge_secret: string; p_service_role_key: string }
        Returns: undefined
      }
      bump_finance_partner_activity: {
        Args: { _contact_id: string }
        Returns: undefined
      }
      calculate_data_quality_score: {
        Args: { report_id: string }
        Returns: number
      }
      cancel_commission_payout: {
        Args: { p_actor_id: string; p_payout_id: string; p_reason: string }
        Returns: {
          approval_note: string | null
          approved_at: string | null
          approved_by: string | null
          broker_id: string
          broker_name: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          entry_count: number
          generated_by: string | null
          id: string
          idempotency_key: string | null
          ledger_entry_ids: string[] | null
          notes: string | null
          paid_at: string | null
          payment_method: string | null
          payment_reference: string | null
          pdf_hash: string | null
          pdf_storage_path: string | null
          period_end: string
          period_start: string
          status: Database["public"]["Enums"]["payout_status"]
          total_gross: number
          total_gst: number
          total_net: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "commission_payouts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_migration_job: {
        Args: { p_immediate?: boolean; p_job_id: string }
        Returns: undefined
      }
      chart_config_is_live: { Args: { cfg: Json }; Returns: boolean }
      check_and_bump_rate_limit: {
        Args: { p_key: string; p_max: number; p_window_seconds: number }
        Returns: boolean
      }
      check_pdf_import_success_rate: { Args: never; Returns: undefined }
      claim_migration_jobs: {
        Args: { p_lease_seconds?: number; p_limit?: number }
        Returns: {
          dispatch_count: number
          domain: string
          dry_run: boolean
          id: string
          payload: Json
          source_account: string
          target_account: string
        }[]
      }
      claim_next_bulk_item: {
        Args: { p_job_id: string; p_worker: string }
        Returns: {
          attempts: number
          id: string
          property_address: string
          property_listing_id: string
          report_id: string
        }[]
      }
      cleanup_expired_census_cache: { Args: never; Returns: undefined }
      cleanup_expired_climate_cache: { Args: never; Returns: undefined }
      cleanup_expired_crime_cache: { Args: never; Returns: undefined }
      cleanup_expired_economic_cache: { Args: never; Returns: undefined }
      cleanup_expired_portal_sessions: { Args: never; Returns: undefined }
      cleanup_expired_rent_cache: { Args: never; Returns: undefined }
      cleanup_expired_risk_cache: { Args: never; Returns: undefined }
      cleanup_expired_sessions: { Args: never; Returns: undefined }
      cleanup_expired_stamp_duty_cache: { Args: never; Returns: undefined }
      cleanup_expired_transport_cache: { Args: never; Returns: undefined }
      cleanup_old_health_logs: { Args: never; Returns: undefined }
      compute_audit_row_hash: {
        Args: {
          _action: string
          _actor_id: string
          _actor_type: string
          _category: string
          _created_at: string
          _metadata: Json
          _prev_hash: string
          _purchase_file_id: string
          _target_id: string
          _target_type: string
        }
        Returns: string
      }
      consume_client_portal_reset_attempt: {
        Args: { p_email: string; p_max: number }
        Returns: {
          reset_token: string
          status: string
          user_id: string
        }[]
      }
      consume_finance_portal_reset_attempt: {
        Args: { p_email: string; p_max: number }
        Returns: {
          reset_token: string
          status: string
          user_id: string
        }[]
      }
      cron_invoke_signed_function: {
        Args: { body?: Json; caller?: string; function_name: string }
        Returns: number
      }
      cron_service_role_headers: { Args: { extra?: Json }; Returns: Json }
      cron_signed_internal_headers: {
        Args: {
          body?: Json
          caller?: string
          extra?: Json
          function_name: string
          method: string
        }
        Returns: Json
      }
      extract_email_address: { Args: { raw_text: string }; Returns: string }
      finalize_ghl_cutover: { Args: { p_job_id: string }; Returns: Json }
      finalize_migration_upload: {
        Args: { _upload_id: string }
        Returns: {
          id: string
          row_count: number
          status: string
        }[]
      }
      fp_resolve_partner_for_deal: {
        Args: { _deal_id: string }
        Returns: {
          default_rate: number
          finance_contact_id: string
          gst_registered: boolean
        }[]
      }
      gc_pdf_import_jobs: { Args: never; Returns: undefined }
      generate_commission_payout: {
        Args: {
          p_actor_id: string
          p_broker_id: string
          p_broker_name: string
          p_idempotency_key: string
          p_period_end: string
          p_period_start: string
        }
        Returns: {
          approval_note: string | null
          approved_at: string | null
          approved_by: string | null
          broker_id: string
          broker_name: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          entry_count: number
          generated_by: string | null
          id: string
          idempotency_key: string | null
          ledger_entry_ids: string[] | null
          notes: string | null
          paid_at: string | null
          payment_method: string | null
          payment_reference: string | null
          pdf_hash: string | null
          pdf_storage_path: string | null
          period_end: string
          period_start: string
          status: Database["public"]["Enums"]["payout_status"]
          total_gross: number
          total_gst: number
          total_net: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "commission_payouts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_all_cache_stats: {
        Args: never
        Returns: {
          avg_age_days: number
          cache_hit_potential: number
          cache_type: string
          estimated_data: number
          expired_entries: number
          live_data: number
          retention_days: number
          total_entries: number
        }[]
      }
      get_aml_roles_for_user: {
        Args: { _user_id: string }
        Returns: {
          role: string
        }[]
      }
      get_aml_roles_for_users: {
        Args: { _user_ids: string[] }
        Returns: {
          role_name: string
          user_id: string
        }[]
      }
      get_api_health_stats: {
        Args: { days_back?: number }
        Returns: {
          avg_response_time: number
          data_quality_score: number
          error_calls: number
          estimated_data_count: number
          live_data_count: number
          service_name: string
          success_calls: number
          success_rate: number
          total_calls: number
        }[]
      }
      get_cache_statistics: {
        Args: never
        Returns: {
          cache_hit_potential: number
          cache_type: string
          estimated_data: number
          expired_entries: number
          live_data: number
          total_entries: number
        }[]
      }
      get_migration_upload_progress: {
        Args: { _upload_id: string }
        Returns: {
          expected_rows: number
          id: string
          progress_percent: number
          row_count: number
          status: string
        }[]
      }
      get_recent_activities: {
        Args: {
          p_entity_type?: Database["public"]["Enums"]["activity_entity_type"]
          p_limit?: number
          p_user_id?: string
        }
        Returns: {
          action_type: Database["public"]["Enums"]["activity_action_type"]
          created_at: string
          entity_id: string
          entity_name: string
          entity_type: Database["public"]["Enums"]["activity_entity_type"]
          id: string
          metadata: Json
          user_id: string
          username: string
        }[]
      }
      get_report_changelog: {
        Args: {
          p_report_id: string
          p_version_from?: number
          p_version_to?: number
        }
        Returns: {
          changelog: string
          changes_summary: Json
          created_at: string
          quality_score: number
          validation_count: number
          version_number: number
        }[]
      }
      get_schools_statistics: {
        Args: never
        Returns: {
          avg_icsea: number
          by_level: Json
          by_state: Json
          by_type: Json
          total_schools: number
          total_students: number
        }[]
      }
      get_shared_qa_answer: {
        Args: { _share_token: string }
        Returns: {
          content: string
          conversation_id: string
          conversation_title: string
          created_at: string
          message_id: string
          model_provider: string
          role: string
        }[]
      }
      get_user_activity_summary: {
        Args: { p_days_back?: number; p_user_id: string }
        Returns: {
          action_type: Database["public"]["Enums"]["activity_action_type"]
          count: number
          entity_type: Database["public"]["Enums"]["activity_entity_type"]
          last_occurrence: string
        }[]
      }
      ghl_rate_note_429: {
        Args: { p_cooldown_ms: number; p_token_key: string }
        Returns: undefined
      }
      ghl_rate_reserve: {
        Args: {
          p_max_per_window: number
          p_token_key: string
          p_window_ms: number
        }
        Returns: number
      }
      has_aml_role: {
        Args: {
          _role: "analyst" | "reviewer" | "mlro" | "auditor"
          _user_id: string
        }
        Returns: boolean
      }
      has_aml_write_role: { Args: { _user_id: string }; Returns: boolean }
      has_any_aml_role: { Args: { _user_id: string }; Returns: boolean }
      has_module_access: {
        Args: { _module_key: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      heartbeat_migration_job: {
        Args: { p_job_id: string; p_lease_seconds?: number }
        Returns: undefined
      }
      increment_blacklist_hit: {
        Args: { entry_id: string }
        Returns: undefined
      }
      invoke_pdf_parse_recover_stuck_jobs: { Args: never; Returns: undefined }
      list_resumable_bulk_jobs: {
        Args: never
        Returns: {
          created_by: string
          job_id: string
          pending_count: number
        }[]
      }
      list_truncated_email_ids: {
        Args: { _limit?: number }
        Returns: {
          body: string
          id: string
          received_at: string
          sender: string
          subject: string
        }[]
      }
      log_activity: {
        Args: {
          p_action_type: Database["public"]["Enums"]["activity_action_type"]
          p_entity_id?: string
          p_entity_name?: string
          p_entity_type: Database["public"]["Enums"]["activity_entity_type"]
          p_ip_address?: string
          p_metadata?: Json
          p_user_agent?: string
          p_user_id: string
          p_username: string
        }
        Returns: string
      }
      mark_commission_payout_paid: {
        Args: {
          p_approval_note: string
          p_approver_id: string
          p_payment_method: string
          p_payment_reference: string
          p_payout_id: string
        }
        Returns: {
          approval_note: string | null
          approved_at: string | null
          approved_by: string | null
          broker_id: string
          broker_name: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          entry_count: number
          generated_by: string | null
          id: string
          idempotency_key: string | null
          ledger_entry_ids: string[] | null
          notes: string | null
          paid_at: string | null
          payment_method: string | null
          payment_reference: string | null
          pdf_hash: string | null
          pdf_storage_path: string | null
          period_end: string
          period_start: string
          status: Database["public"]["Enums"]["payout_status"]
          total_gross: number
          total_gst: number
          total_net: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "commission_payouts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      match_agent_memories: {
        Args: {
          p_match_count?: number
          p_min_similarity?: number
          p_query_embedding: string
          p_user_id: string
        }
        Returns: {
          content: string
          created_at: string
          feedback_score: number
          id: string
          importance: number
          kind: string
          similarity: number
          tags: string[]
        }[]
      }
      match_document_chunks: {
        Args: {
          match_conversation_id?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          chunk_index: number
          chunk_text: string
          conversation_id: string
          document_name: string
          id: string
          page_number: number
          paragraph_index: number
          similarity: number
        }[]
      }
      match_document_chunks_hybrid: {
        Args: {
          keyword_weight?: number
          match_conversation_id?: string
          match_count?: number
          match_document_names?: string[]
          match_postcode?: string
          match_report_type?: string
          match_state?: string
          match_suburb?: string
          match_threshold?: number
          query_embedding: string
          query_text?: string
          semantic_weight?: number
        }
        Returns: {
          chunk_index: number
          chunk_text: string
          conversation_id: string
          document_name: string
          hybrid_score: number
          id: string
          keyword_rank: number
          page_number: number
          paragraph_index: number
          postcode: string
          report_type: string
          similarity: number
          state: string
          suburb: string
        }[]
      }
      pause_migration_job: { Args: { p_job_id: string }; Returns: undefined }
      pdf_import_watchdog_sweep: { Args: never; Returns: number }
      prune_agent_memories: {
        Args: { p_max?: number; p_user_id: string }
        Returns: number
      }
      read_migration_control_signal: {
        Args: { p_job_id: string }
        Returns: string
      }
      recompute_migration_job_counters: {
        Args: { p_job_id: string }
        Returns: Json
      }
      refresh_pdf_import_cost_daily: { Args: never; Returns: undefined }
      release_migration_job_lock: {
        Args: { p_job_id: string }
        Returns: undefined
      }
      requeue_stale_bulk_items: {
        Args: never
        Returns: {
          failed_count: number
          requeued_count: number
        }[]
      }
      resolve_client_display_name: {
        Args: { p_client_id: string }
        Returns: string
      }
      resolve_report_template: {
        Args: {
          p_agency_id?: string
          p_report_type: string
          p_user_id?: string
          p_variant?: string
        }
        Returns: {
          source: string
          template: Json
        }[]
      }
      resume_migration_job: { Args: { p_job_id: string }; Returns: undefined }
      retry_failed_bulk_items: { Args: { p_job_id: string }; Returns: number }
      seed_sample_schools: { Args: never; Returns: undefined }
      seed_settlement_runway: { Args: { _file_id: string }; Returns: undefined }
      template_finalize: {
        Args: {
          p_description: string
          p_import_id: string
          p_meta?: Json
          p_name: string
          p_page_count?: number
          p_schema: Json
        }
        Returns: {
          active_theme: string
          agency_id: string | null
          approval_status: string
          branch_label: string | null
          brand_kit_id: string | null
          config: Json
          created_at: string
          created_by: string | null
          custom_css: string | null
          description: string | null
          engine: string
          id: string
          is_active: boolean
          is_default: boolean | null
          is_draft: boolean
          locked_at: string | null
          locked_by: string | null
          locked_for_review: boolean
          name: string
          owner_user_id: string | null
          parent_template_id: string | null
          priority: number
          report_type: string | null
          schema: Json
          scope: string
          thumbnail_url: string | null
          tier: string | null
          updated_at: string
          variant: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "report_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      template_finalize_v2: {
        Args: {
          p_description: string
          p_import_id: string
          p_meta?: Json
          p_name: string
          p_page_count?: number
          p_schema: Json
        }
        Returns: {
          id: string
          name: string
          version: number
        }[]
      }
      template_resync: {
        Args: { p_note?: string; p_schema: Json; p_template_id: string }
        Returns: {
          active_theme: string
          agency_id: string | null
          approval_status: string
          branch_label: string | null
          brand_kit_id: string | null
          config: Json
          created_at: string
          created_by: string | null
          custom_css: string | null
          description: string | null
          engine: string
          id: string
          is_active: boolean
          is_default: boolean | null
          is_draft: boolean
          locked_at: string | null
          locked_by: string | null
          locked_for_review: boolean
          name: string
          owner_user_id: string | null
          parent_template_id: string | null
          priority: number
          report_type: string | null
          schema: Json
          scope: string
          thumbnail_url: string | null
          tier: string | null
          updated_at: string
          variant: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "report_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      template_resync_v2: {
        Args: { p_note?: string; p_schema: Json; p_template_id: string }
        Returns: {
          id: string
          name: string
          version: number
        }[]
      }
      validate_property_specs: {
        Args: { specs: Json }
        Returns: {
          is_valid: boolean
          missing_fields: string[]
        }[]
      }
    }
    Enums: {
      activity_action_type:
        | "report_generated"
        | "report_regenerated"
        | "report_viewed"
        | "report_edited"
        | "report_archived"
        | "report_deleted"
        | "report_pdf_downloaded"
        | "report_shared"
        | "manual_override_applied"
        | "comparison_created"
        | "comparison_viewed"
        | "comparison_deleted"
        | "cash_flow_created"
        | "cash_flow_updated"
        | "cash_flow_deleted"
        | "email_read"
        | "email_reply_generated"
        | "email_reply_sent"
        | "email_linked_to_report"
        | "call_tagged"
        | "alert_rule_created"
        | "alert_rule_updated"
        | "alert_rule_deleted"
        | "weekly_report_config_changed"
        | "qa_conversation_created"
        | "qa_question_asked"
        | "qa_conversation_deleted"
        | "automation_switch_created"
        | "automation_switch_enabled"
        | "automation_switch_disabled"
        | "automation_switch_deleted"
        | "automation_master_toggle_changed"
        | "template_uploaded"
        | "template_activated"
        | "template_deactivated"
        | "template_deleted"
        | "branding_profile_created"
        | "branding_profile_updated"
        | "branding_profile_deleted"
        | "user_invited"
        | "user_permissions_changed"
        | "user_deactivated"
        | "user_activated"
        | "password_reset_initiated"
        | "whitelabel_settings_updated"
        | "whitelabel_logo_changed"
        | "user_login"
        | "user_logout"
        | "bulk_generation_started"
        | "bulk_generation_completed"
        | "settings_updated"
        | "data_exported"
        | "login"
        | "logout"
        | "branding_created"
        | "branding_updated"
        | "branding_deleted"
        | "user_created"
        | "user_deleted"
        | "user_promoted"
        | "user_demoted"
        | "permissions_updated"
        | "client_created"
        | "client_updated"
        | "client_deleted"
        | "client_exported"
        | "client_file_uploaded"
        | "client_file_deleted"
        | "client_note_added"
        | "client_tag_added"
        | "client_tag_removed"
        | "deal_created"
        | "deal_updated"
        | "deal_stage_changed"
        | "deal_deleted"
        | "build_payment_updated"
        | "appointment_created"
        | "appointment_updated"
        | "appointment_deleted"
        | "appointment_rescheduled"
        | "checklist_generated"
        | "checklist_item_checked"
        | "checklist_completed"
        | "checklist_deleted"
        | "data_imported"
        | "whitelabel_logo_uploaded"
        | "whitelabel_logo_removed"
        | "whitelabel_theme_changed"
        | "comparison_pdf_downloaded"
        | "portfolio_report_generated"
        | "agreement_generated"
        | "agreement_sent"
        | "agreement_signed"
        | "agreement_voided"
        | "portal_message_sent"
        | "portal_message_received"
      activity_entity_type:
        | "investment_report"
        | "property_comparison"
        | "cash_flow_analysis"
        | "email"
        | "call_log"
        | "call_alert_rule"
        | "qa_conversation"
        | "automation_switch"
        | "template"
        | "branding_profile"
        | "user"
        | "whitelabel_settings"
        | "bulk_generation_job"
        | "system"
        | "session"
        | "branding"
        | "client"
        | "deal"
        | "client_file"
        | "client_note"
        | "appointment"
        | "checklist"
        | "data_import"
        | "portfolio_report"
        | "agency_agreement"
        | "portal_message"
      app_role: "superadmin" | "admin" | "user"
      attribution_source_type:
        | "webhook_auto"
        | "manual"
        | "csv_import"
        | "backfill"
      client_note_visibility:
        | "shared"
        | "internal_npc"
        | "client_only"
        | "finance_only"
      commercial_asset_class:
        | "office"
        | "retail"
        | "industrial"
        | "mixed_use"
        | "medical"
        | "childcare"
        | "hospitality"
        | "other"
      commercial_gst_treatment:
        | "going_concern"
        | "margin_scheme"
        | "standard"
        | "input_taxed"
      commercial_lease_status:
        | "occupied"
        | "vacant"
        | "holdover"
        | "under_offer"
        | "expired"
      commercial_rent_basis: "gross" | "net" | "semi_gross"
      commercial_review_type:
        | "cpi"
        | "fixed_percent"
        | "market"
        | "hybrid"
        | "none"
      commercial_security_type:
        | "bond"
        | "bank_guarantee"
        | "personal_guarantee"
        | "none"
      commercial_tenure: "freehold" | "leasehold" | "strata"
      commission_status:
        | "forecast"
        | "invoiced"
        | "received"
        | "reconciled"
        | "clawed_back"
      commission_type: "upfront" | "trail" | "bonus" | "clawback"
      compliance_record_type:
        | "bid"
        | "fact_find"
        | "preliminary_assessment"
        | "credit_guide"
        | "privacy_consent"
        | "fha"
        | "best_interests_duty"
        | "cost_disclosure"
      compliance_status:
        | "draft"
        | "pending_signature"
        | "signed"
        | "expired"
        | "superseded"
        | "voided"
      condition_owner:
        | "client"
        | "npc_team"
        | "finance_partner"
        | "legal"
        | "other"
      condition_status:
        | "pending"
        | "in_progress"
        | "uploaded"
        | "satisfied"
        | "waived"
      deal_risk_status: "on_track" | "needs_follow_up" | "urgent"
      deal_stage_status: "pending" | "in_progress" | "complete" | "skipped"
      deal_type: "existing_property" | "house_and_land" | "refinance"
      depreciation_finish_standard: "low" | "medium" | "high"
      depreciation_nearest_city:
        | "sydney_nsw"
        | "melbourne_vic"
        | "perth_wa"
        | "brisbane_qld"
        | "adelaide_sa"
        | "cairns_qld"
        | "canberra_act"
        | "darwin_nt"
        | "hobart_tas"
      depreciation_property_type:
        | "house"
        | "townhouse"
        | "unit"
        | "highrise"
        | "commercial"
        | "industrial"
      depreciation_purchase_date_category:
        | "pre_budget"
        | "post_budget_second_hand"
        | "post_budget_brand_new"
      document_requirement_category:
        | "identity"
        | "income_payg"
        | "income_self_employed"
        | "bank_statements"
        | "existing_loans"
        | "assets"
        | "liabilities"
        | "purchase_docs"
        | "deposit_proof"
        | "valuation"
        | "loan_approval"
        | "settlement"
        | "other"
      document_requirement_owner:
        | "client"
        | "finance_partner"
        | "npc_team"
        | "legal"
        | "other"
      document_requirement_status:
        | "required"
        | "requested"
        | "uploaded"
        | "verified"
        | "waived"
        | "expired"
      finance_decision_outcome:
        | "green_light"
        | "proceed_with_caution"
        | "not_suitable"
        | "need_more_info"
        | "subject_to_valuation"
        | "subject_to_lender_review"
        | "subject_to_equity"
        | "subject_to_deposit"
        | "subject_to_lmi_approval"
      generated_doc_status:
        | "draft"
        | "generated"
        | "sent"
        | "viewed"
        | "signed"
        | "voided"
        | "expired"
      lender_doc_status: "required" | "received" | "verified" | "waived"
      lender_loan_purpose: "OWNER_OCCUPIED" | "INVESTMENT"
      lender_repayment_type: "PRINCIPAL_AND_INTEREST" | "INTEREST_ONLY"
      lender_submission_status:
        | "draft"
        | "pre_assessment"
        | "submitted"
        | "conditional_approval"
        | "unconditional_approval"
        | "loan_docs_issued"
        | "settled"
        | "declined"
        | "withdrawn"
      message_allocation_status:
        | "none"
        | "finance_action_required"
        | "finance_review_required"
        | "finance_input_required"
        | "allocate_to_finance"
      message_visibility_scope:
        | "command_finance_private"
        | "command_client_private"
        | "command_client_with_finance_allocated"
        | "finance_client_with_command_visibility"
        | "internal_command_only"
      payout_status: "draft" | "pending" | "paid" | "cancelled"
      pf_client_task_status:
        | "pending"
        | "in_progress"
        | "completed"
        | "dismissed"
        | "expired"
      pf_client_task_type:
        | "document_upload"
        | "lender_condition_action"
        | "signature_request"
        | "information_request"
        | "decision_required"
        | "payment_required"
        | "other"
      pf_settlement_task_key:
        | "identity_verified"
        | "solicitor_engaged"
        | "loan_docs_issued"
        | "loan_docs_signed"
        | "insurance_arranged"
        | "settlement_funds_ready"
        | "lender_funder_booked"
        | "final_inspection"
        | "settlement_attended"
      pf_settlement_task_status:
        | "pending"
        | "in_progress"
        | "completed"
        | "blocked"
        | "not_applicable"
      portal_report_request_status:
        | "pending"
        | "in_progress"
        | "completed"
        | "declined"
      portal_report_request_type:
        | "portfolio_review"
        | "borrowing_capacity"
        | "investment_property"
      purchase_critical_date_status:
        | "on_track"
        | "due_soon"
        | "overdue"
        | "completed"
      purchase_critical_date_type:
        | "offer_submitted"
        | "contract_received"
        | "cooling_off_expiry"
        | "finance_clause_expiry"
        | "building_pest_deadline"
        | "deposit_due"
        | "valuation_due"
        | "loan_approval_target"
        | "settlement"
      purchase_file_status:
        | "draft"
        | "active"
        | "on_hold"
        | "at_risk"
        | "settled"
        | "cancelled"
      purchase_file_type:
        | "existing_property"
        | "off_the_plan"
        | "house_and_land"
        | "land_only"
        | "build_only"
        | "dual_occupancy"
        | "smsf"
        | "commercial"
        | "refinance_equity"
      purchase_finance_status:
        | "not_started"
        | "docs_requested"
        | "docs_received"
        | "in_review"
        | "pre_approval_in_progress"
        | "pre_approved"
        | "purchase_specific_review"
        | "green_light_given"
        | "proceed_with_caution"
        | "application_lodged"
        | "conditional_approval"
        | "valuation_pending"
        | "valuation_returned"
        | "unconditional_approval"
        | "loan_docs_issued"
        | "ready_for_settlement"
        | "settled"
        | "at_risk"
      record_source_actor_type:
        | "internal_user"
        | "finance_user"
        | "client_user"
        | "system"
      record_source_surface:
        | "internal_dashboard"
        | "finance_portal"
        | "client_portal"
        | "automation"
        | "external_system"
      report_category_enum:
        | "investment"
        | "comparison"
        | "suburb_snapshot"
        | "cash_flow"
        | "suburb"
        | "postcode"
        | "statewide"
      report_tier_enum: "compass" | "executive" | "snapshot"
      signature_method: "docusign" | "wet" | "portal_consent" | "email_consent"
      sync_status_type:
        | "local"
        | "synced"
        | "duplicate"
        | "superseded"
        | "conflict"
      template_doc_type:
        | "loan_application"
        | "supporting_docs_cover"
        | "bid"
        | "credit_guide"
        | "cost_disclosure"
        | "consent_form"
        | "fact_find"
        | "preliminary_assessment"
        | "generic"
      template_type:
        | "ai_structure"
        | "pdf_layout"
        | "client_branding"
        | "qa_export"
        | "cashflow_export"
      valuation_result: "on_contract" | "above_contract" | "short" | "pending"
      valuation_status:
        | "ordered"
        | "access_pending"
        | "inspected"
        | "returned"
        | "disputed"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_action_type: [
        "report_generated",
        "report_regenerated",
        "report_viewed",
        "report_edited",
        "report_archived",
        "report_deleted",
        "report_pdf_downloaded",
        "report_shared",
        "manual_override_applied",
        "comparison_created",
        "comparison_viewed",
        "comparison_deleted",
        "cash_flow_created",
        "cash_flow_updated",
        "cash_flow_deleted",
        "email_read",
        "email_reply_generated",
        "email_reply_sent",
        "email_linked_to_report",
        "call_tagged",
        "alert_rule_created",
        "alert_rule_updated",
        "alert_rule_deleted",
        "weekly_report_config_changed",
        "qa_conversation_created",
        "qa_question_asked",
        "qa_conversation_deleted",
        "automation_switch_created",
        "automation_switch_enabled",
        "automation_switch_disabled",
        "automation_switch_deleted",
        "automation_master_toggle_changed",
        "template_uploaded",
        "template_activated",
        "template_deactivated",
        "template_deleted",
        "branding_profile_created",
        "branding_profile_updated",
        "branding_profile_deleted",
        "user_invited",
        "user_permissions_changed",
        "user_deactivated",
        "user_activated",
        "password_reset_initiated",
        "whitelabel_settings_updated",
        "whitelabel_logo_changed",
        "user_login",
        "user_logout",
        "bulk_generation_started",
        "bulk_generation_completed",
        "settings_updated",
        "data_exported",
        "login",
        "logout",
        "branding_created",
        "branding_updated",
        "branding_deleted",
        "user_created",
        "user_deleted",
        "user_promoted",
        "user_demoted",
        "permissions_updated",
        "client_created",
        "client_updated",
        "client_deleted",
        "client_exported",
        "client_file_uploaded",
        "client_file_deleted",
        "client_note_added",
        "client_tag_added",
        "client_tag_removed",
        "deal_created",
        "deal_updated",
        "deal_stage_changed",
        "deal_deleted",
        "build_payment_updated",
        "appointment_created",
        "appointment_updated",
        "appointment_deleted",
        "appointment_rescheduled",
        "checklist_generated",
        "checklist_item_checked",
        "checklist_completed",
        "checklist_deleted",
        "data_imported",
        "whitelabel_logo_uploaded",
        "whitelabel_logo_removed",
        "whitelabel_theme_changed",
        "comparison_pdf_downloaded",
        "portfolio_report_generated",
        "agreement_generated",
        "agreement_sent",
        "agreement_signed",
        "agreement_voided",
        "portal_message_sent",
        "portal_message_received",
      ],
      activity_entity_type: [
        "investment_report",
        "property_comparison",
        "cash_flow_analysis",
        "email",
        "call_log",
        "call_alert_rule",
        "qa_conversation",
        "automation_switch",
        "template",
        "branding_profile",
        "user",
        "whitelabel_settings",
        "bulk_generation_job",
        "system",
        "session",
        "branding",
        "client",
        "deal",
        "client_file",
        "client_note",
        "appointment",
        "checklist",
        "data_import",
        "portfolio_report",
        "agency_agreement",
        "portal_message",
      ],
      app_role: ["superadmin", "admin", "user"],
      attribution_source_type: [
        "webhook_auto",
        "manual",
        "csv_import",
        "backfill",
      ],
      client_note_visibility: [
        "shared",
        "internal_npc",
        "client_only",
        "finance_only",
      ],
      commercial_asset_class: [
        "office",
        "retail",
        "industrial",
        "mixed_use",
        "medical",
        "childcare",
        "hospitality",
        "other",
      ],
      commercial_gst_treatment: [
        "going_concern",
        "margin_scheme",
        "standard",
        "input_taxed",
      ],
      commercial_lease_status: [
        "occupied",
        "vacant",
        "holdover",
        "under_offer",
        "expired",
      ],
      commercial_rent_basis: ["gross", "net", "semi_gross"],
      commercial_review_type: [
        "cpi",
        "fixed_percent",
        "market",
        "hybrid",
        "none",
      ],
      commercial_security_type: [
        "bond",
        "bank_guarantee",
        "personal_guarantee",
        "none",
      ],
      commercial_tenure: ["freehold", "leasehold", "strata"],
      commission_status: [
        "forecast",
        "invoiced",
        "received",
        "reconciled",
        "clawed_back",
      ],
      commission_type: ["upfront", "trail", "bonus", "clawback"],
      compliance_record_type: [
        "bid",
        "fact_find",
        "preliminary_assessment",
        "credit_guide",
        "privacy_consent",
        "fha",
        "best_interests_duty",
        "cost_disclosure",
      ],
      compliance_status: [
        "draft",
        "pending_signature",
        "signed",
        "expired",
        "superseded",
        "voided",
      ],
      condition_owner: [
        "client",
        "npc_team",
        "finance_partner",
        "legal",
        "other",
      ],
      condition_status: [
        "pending",
        "in_progress",
        "uploaded",
        "satisfied",
        "waived",
      ],
      deal_risk_status: ["on_track", "needs_follow_up", "urgent"],
      deal_stage_status: ["pending", "in_progress", "complete", "skipped"],
      deal_type: ["existing_property", "house_and_land", "refinance"],
      depreciation_finish_standard: ["low", "medium", "high"],
      depreciation_nearest_city: [
        "sydney_nsw",
        "melbourne_vic",
        "perth_wa",
        "brisbane_qld",
        "adelaide_sa",
        "cairns_qld",
        "canberra_act",
        "darwin_nt",
        "hobart_tas",
      ],
      depreciation_property_type: [
        "house",
        "townhouse",
        "unit",
        "highrise",
        "commercial",
        "industrial",
      ],
      depreciation_purchase_date_category: [
        "pre_budget",
        "post_budget_second_hand",
        "post_budget_brand_new",
      ],
      document_requirement_category: [
        "identity",
        "income_payg",
        "income_self_employed",
        "bank_statements",
        "existing_loans",
        "assets",
        "liabilities",
        "purchase_docs",
        "deposit_proof",
        "valuation",
        "loan_approval",
        "settlement",
        "other",
      ],
      document_requirement_owner: [
        "client",
        "finance_partner",
        "npc_team",
        "legal",
        "other",
      ],
      document_requirement_status: [
        "required",
        "requested",
        "uploaded",
        "verified",
        "waived",
        "expired",
      ],
      finance_decision_outcome: [
        "green_light",
        "proceed_with_caution",
        "not_suitable",
        "need_more_info",
        "subject_to_valuation",
        "subject_to_lender_review",
        "subject_to_equity",
        "subject_to_deposit",
        "subject_to_lmi_approval",
      ],
      generated_doc_status: [
        "draft",
        "generated",
        "sent",
        "viewed",
        "signed",
        "voided",
        "expired",
      ],
      lender_doc_status: ["required", "received", "verified", "waived"],
      lender_loan_purpose: ["OWNER_OCCUPIED", "INVESTMENT"],
      lender_repayment_type: ["PRINCIPAL_AND_INTEREST", "INTEREST_ONLY"],
      lender_submission_status: [
        "draft",
        "pre_assessment",
        "submitted",
        "conditional_approval",
        "unconditional_approval",
        "loan_docs_issued",
        "settled",
        "declined",
        "withdrawn",
      ],
      message_allocation_status: [
        "none",
        "finance_action_required",
        "finance_review_required",
        "finance_input_required",
        "allocate_to_finance",
      ],
      message_visibility_scope: [
        "command_finance_private",
        "command_client_private",
        "command_client_with_finance_allocated",
        "finance_client_with_command_visibility",
        "internal_command_only",
      ],
      payout_status: ["draft", "pending", "paid", "cancelled"],
      pf_client_task_status: [
        "pending",
        "in_progress",
        "completed",
        "dismissed",
        "expired",
      ],
      pf_client_task_type: [
        "document_upload",
        "lender_condition_action",
        "signature_request",
        "information_request",
        "decision_required",
        "payment_required",
        "other",
      ],
      pf_settlement_task_key: [
        "identity_verified",
        "solicitor_engaged",
        "loan_docs_issued",
        "loan_docs_signed",
        "insurance_arranged",
        "settlement_funds_ready",
        "lender_funder_booked",
        "final_inspection",
        "settlement_attended",
      ],
      pf_settlement_task_status: [
        "pending",
        "in_progress",
        "completed",
        "blocked",
        "not_applicable",
      ],
      portal_report_request_status: [
        "pending",
        "in_progress",
        "completed",
        "declined",
      ],
      portal_report_request_type: [
        "portfolio_review",
        "borrowing_capacity",
        "investment_property",
      ],
      purchase_critical_date_status: [
        "on_track",
        "due_soon",
        "overdue",
        "completed",
      ],
      purchase_critical_date_type: [
        "offer_submitted",
        "contract_received",
        "cooling_off_expiry",
        "finance_clause_expiry",
        "building_pest_deadline",
        "deposit_due",
        "valuation_due",
        "loan_approval_target",
        "settlement",
      ],
      purchase_file_status: [
        "draft",
        "active",
        "on_hold",
        "at_risk",
        "settled",
        "cancelled",
      ],
      purchase_file_type: [
        "existing_property",
        "off_the_plan",
        "house_and_land",
        "land_only",
        "build_only",
        "dual_occupancy",
        "smsf",
        "commercial",
        "refinance_equity",
      ],
      purchase_finance_status: [
        "not_started",
        "docs_requested",
        "docs_received",
        "in_review",
        "pre_approval_in_progress",
        "pre_approved",
        "purchase_specific_review",
        "green_light_given",
        "proceed_with_caution",
        "application_lodged",
        "conditional_approval",
        "valuation_pending",
        "valuation_returned",
        "unconditional_approval",
        "loan_docs_issued",
        "ready_for_settlement",
        "settled",
        "at_risk",
      ],
      record_source_actor_type: [
        "internal_user",
        "finance_user",
        "client_user",
        "system",
      ],
      record_source_surface: [
        "internal_dashboard",
        "finance_portal",
        "client_portal",
        "automation",
        "external_system",
      ],
      report_category_enum: [
        "investment",
        "comparison",
        "suburb_snapshot",
        "cash_flow",
        "suburb",
        "postcode",
        "statewide",
      ],
      report_tier_enum: ["compass", "executive", "snapshot"],
      signature_method: ["docusign", "wet", "portal_consent", "email_consent"],
      sync_status_type: [
        "local",
        "synced",
        "duplicate",
        "superseded",
        "conflict",
      ],
      template_doc_type: [
        "loan_application",
        "supporting_docs_cover",
        "bid",
        "credit_guide",
        "cost_disclosure",
        "consent_form",
        "fact_find",
        "preliminary_assessment",
        "generic",
      ],
      template_type: [
        "ai_structure",
        "pdf_layout",
        "client_branding",
        "qa_export",
        "cashflow_export",
      ],
      valuation_result: ["on_contract", "above_contract", "short", "pending"],
      valuation_status: [
        "ordered",
        "access_pending",
        "inspected",
        "returned",
        "disputed",
        "cancelled",
      ],
    },
  },
} as const
