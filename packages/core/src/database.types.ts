
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "alerts": {
                  Row: {
                    "assignment_id": string | null,"calendar_feed_token": string | null,"created_at": string,"id": string,"kind": string,"message": string | null,"sent_at": string | null,"student_id": string,"week_start": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "assignment_id"?: string | null,"calendar_feed_token"?: string | null,"created_at"?: string,"id"?: string,"kind": string,"message"?: string | null,"sent_at"?: string | null,"student_id": string,"week_start"?: string | null
                  }
                  Update: {
                    "assignment_id"?: string | null,"calendar_feed_token"?: string | null,"created_at"?: string,"id"?: string,"kind"?: string,"message"?: string | null,"sent_at"?: string | null,"student_id"?: string,"week_start"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "alerts_student_id_assignment_id_fkey"
      columns: ["student_id","assignment_id"]
isOneToOne: false
      referencedRelation: "assignments"
      referencedColumns: ["student_id","id"]
    },{
      foreignKeyName: "alerts_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"assignments": {
                  Row: {
                    "canvas_assignment_id": string | null,"course_id": string,"created_at": string,"due_at": string | null,"due_changed_at": string | null,"grade_group_id": string | null,"graded": boolean,"id": string,"points_possible": number | null,"previous_due_at": string | null,"score": number | null,"student_id": string,"submitted": boolean,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "canvas_assignment_id"?: string | null,"course_id": string,"created_at"?: string,"due_at"?: string | null,"due_changed_at"?: string | null,"grade_group_id"?: string | null,"graded"?: boolean,"id"?: string,"points_possible"?: number | null,"previous_due_at"?: string | null,"score"?: number | null,"student_id": string,"submitted"?: boolean,"title": string
                  }
                  Update: {
                    "canvas_assignment_id"?: string | null,"course_id"?: string,"created_at"?: string,"due_at"?: string | null,"due_changed_at"?: string | null,"grade_group_id"?: string | null,"graded"?: boolean,"id"?: string,"points_possible"?: number | null,"previous_due_at"?: string | null,"score"?: number | null,"student_id"?: string,"submitted"?: boolean,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assignments_student_id_course_id_fkey"
      columns: ["student_id","course_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["student_id","id"]
    },{
      foreignKeyName: "assignments_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_student_id_grade_group_id_fkey"
      columns: ["student_id","grade_group_id"]
isOneToOne: false
      referencedRelation: "grade_groups"
      referencedColumns: ["student_id","id"]
    }
                  ]
                },"chat_messages": {
                  Row: {
                    "channel": string,"cited_file_id": string | null,"cited_page": number | null,"created_at": string,"id": string,"role": string,"session_id": string,"student_id": string,"text": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel": string,"cited_file_id"?: string | null,"cited_page"?: number | null,"created_at"?: string,"id"?: string,"role": string,"session_id": string,"student_id": string,"text": string
                  }
                  Update: {
                    "channel"?: string,"cited_file_id"?: string | null,"cited_page"?: number | null,"created_at"?: string,"id"?: string,"role"?: string,"session_id"?: string,"student_id"?: string,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_messages_student_id_cited_file_id_fkey"
      columns: ["student_id","cited_file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["student_id","id"]
    },{
      foreignKeyName: "chat_messages_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_messages_student_id_session_id_fkey"
      columns: ["student_id","session_id"]
isOneToOne: false
      referencedRelation: "chat_sessions"
      referencedColumns: ["student_id","id"]
    }
                  ]
                },"chat_sessions": {
                  Row: {
                    "channel": string,"created_at": string,"id": string,"student_id": string,"title": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "channel": string,"created_at"?: string,"id"?: string,"student_id": string,"title"?: string | null
                  }
                  Update: {
                    "channel"?: string,"created_at"?: string,"id"?: string,"student_id"?: string,"title"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_sessions_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"courses": {
                  Row: {
                    "canvas_course_id": string | null,"created_at": string,"id": string,"name": string,"student_id": string,"term": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "canvas_course_id"?: string | null,"created_at"?: string,"id"?: string,"name": string,"student_id": string,"term"?: string | null
                  }
                  Update: {
                    "canvas_course_id"?: string | null,"created_at"?: string,"id"?: string,"name"?: string,"student_id"?: string,"term"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "courses_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"file_pages": {
                  Row: {
                    "created_at": string,"file_id": string,"id": string,"page_number": number,"search": unknown,"student_id": string,"text": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"file_id": string,"id"?: string,"page_number": number,"search"?: never,"student_id": string,"text"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"file_id"?: string,"id"?: string,"page_number"?: number,"search"?: never,"student_id"?: string,"text"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "file_pages_student_id_file_id_fkey"
      columns: ["student_id","file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["student_id","id"]
    },{
      foreignKeyName: "file_pages_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"files": {
                  Row: {
                    "added_at": string,"canvas_file_id": string | null,"course_id": string,"created_at": string,"id": string,"ingest_error": string | null,"ingest_status": string,"page_count": number | null,"source": string,"storage_path": string | null,"student_id": string,"title": string,"week_label": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"canvas_file_id"?: string | null,"course_id": string,"created_at"?: string,"id"?: string,"ingest_error"?: string | null,"ingest_status"?: string,"page_count"?: number | null,"source"?: string,"storage_path"?: string | null,"student_id": string,"title": string,"week_label"?: string | null
                  }
                  Update: {
                    "added_at"?: string,"canvas_file_id"?: string | null,"course_id"?: string,"created_at"?: string,"id"?: string,"ingest_error"?: string | null,"ingest_status"?: string,"page_count"?: number | null,"source"?: string,"storage_path"?: string | null,"student_id"?: string,"title"?: string,"week_label"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "files_student_id_course_id_fkey"
      columns: ["student_id","course_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["student_id","id"]
    },{
      foreignKeyName: "files_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"grade_groups": {
                  Row: {
                    "canvas_group_id": string | null,"course_id": string,"created_at": string,"id": string,"name": string,"student_id": string,"weight_percent": number
                  }
                  ComputedFields: never
                  Insert: {
                    "canvas_group_id"?: string | null,"course_id": string,"created_at"?: string,"id"?: string,"name": string,"student_id": string,"weight_percent"?: number
                  }
                  Update: {
                    "canvas_group_id"?: string | null,"course_id"?: string,"created_at"?: string,"id"?: string,"name"?: string,"student_id"?: string,"weight_percent"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "grade_groups_student_id_course_id_fkey"
      columns: ["student_id","course_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["student_id","id"]
    },{
      foreignKeyName: "grade_groups_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"magic_links": {
                  Row: {
                    "created_at": string,"expires_at": string,"file_id": string,"id": string,"page": number,"student_id": string,"token_hash": string,"used_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expires_at": string,"file_id": string,"id"?: string,"page"?: number,"student_id": string,"token_hash": string,"used_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string,"file_id"?: string,"id"?: string,"page"?: number,"student_id"?: string,"token_hash"?: string,"used_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "magic_links_student_id_file_id_fkey"
      columns: ["student_id","file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["student_id","id"]
    },{
      foreignKeyName: "magic_links_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"phone_link_codes": {
                  Row: {
                    "code_hash": string,"created_at": string,"expires_at": string,"id": string,"student_id": string,"used_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "code_hash": string,"created_at"?: string,"expires_at": string,"id"?: string,"student_id": string,"used_at"?: string | null
                  }
                  Update: {
                    "code_hash"?: string,"created_at"?: string,"expires_at"?: string,"id"?: string,"student_id"?: string,"used_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "phone_link_codes_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "canvas_base_url": string | null,"canvas_token_encrypted": string | null,"created_at": string,"id": string,"name": string | null,"phone": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "canvas_base_url"?: string | null,"canvas_token_encrypted"?: string | null,"created_at"?: string,"id": string,"name"?: string | null,"phone"?: string | null
                  }
                  Update: {
                    "canvas_base_url"?: string | null,"canvas_token_encrypted"?: string | null,"created_at"?: string,"id"?: string,"name"?: string | null,"phone"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"saved_notes": {
                  Row: {
                    "body": string,"course_id": string | null,"created_at": string,"id": string,"session_id": string | null,"sources": NonNullable<Json>,"student_id": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"course_id"?: string | null,"created_at"?: string,"id"?: string,"session_id"?: string | null,"sources"?: NonNullable<Json>,"student_id": string,"title": string
                  }
                  Update: {
                    "body"?: string,"course_id"?: string | null,"created_at"?: string,"id"?: string,"session_id"?: string | null,"sources"?: NonNullable<Json>,"student_id"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "saved_notes_student_id_course_id_fkey"
      columns: ["student_id","course_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["student_id","id"]
    },{
      foreignKeyName: "saved_notes_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "saved_notes_student_id_session_id_fkey"
      columns: ["student_id","session_id"]
isOneToOne: false
      referencedRelation: "chat_sessions"
      referencedColumns: ["student_id","id"]
    }
                  ]
                },"sms_inbound_receipts": {
                  Row: {
                    "created_at": string,"dedupe_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"dedupe_key": string
                  }
                  Update: {
                    "created_at"?: string,"dedupe_key"?: string
                  }
                  Relationships: [
                    
                  ]
                },"sms_messages": {
                  Row: {
                    "body": string,"created_at": string,"direction": string,"id": string,"phone": string | null,"provider": string | null,"student_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"created_at"?: string,"direction": string,"id"?: string,"phone"?: string | null,"provider"?: string | null,"student_id": string
                  }
                  Update: {
                    "body"?: string,"created_at"?: string,"direction"?: string,"id"?: string,"phone"?: string | null,"provider"?: string | null,"student_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sms_messages_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"study_blocks": {
                  Row: {
                    "alert_id": string,"course_id": string | null,"created_at": string,"ends_at": string,"id": string,"starts_at": string,"student_id": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alert_id": string,"course_id"?: string | null,"created_at"?: string,"ends_at": string,"id"?: string,"starts_at": string,"student_id": string,"title": string
                  }
                  Update: {
                    "alert_id"?: string,"course_id"?: string | null,"created_at"?: string,"ends_at"?: string,"id"?: string,"starts_at"?: string,"student_id"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "study_blocks_student_id_alert_id_fkey"
      columns: ["student_id","alert_id"]
isOneToOne: false
      referencedRelation: "alerts"
      referencedColumns: ["student_id","id"]
    },{
      foreignKeyName: "study_blocks_student_id_course_id_fkey"
      columns: ["student_id","course_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["student_id","id"]
    },{
      foreignKeyName: "study_blocks_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "search_notes":
{ Args: { "p_course_id"?: string,"p_limit"?: number,"p_query": string,"p_student_id": string }; Returns: {
              "course_id": string,"course_name": string,"file_id": string,"file_title": string,"page_number": number,"rank": number,"snippet": string,"week_label": string
            }[]
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
