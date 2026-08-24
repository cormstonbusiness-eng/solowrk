import type { Database, Row } from '../db'
import type { BusinessSettings, Settings } from '@shared/types'

/**
 * The settings row is the one table with a fixed shape and a single record, so
 * it gets an explicit mapper both ways rather than anything generic. Column
 * names stay snake_case in SQL and camelCase in TypeScript.
 */
interface SettingsRow extends Row {
  business_name: string
  contact_name: string
  email: string
  phone: string
  address_line1: string
  address_line2: string
  city: string
  postcode: string
  country: string
  vat_registered: number
  vat_number: string
  vat_rate: number
  currency: string
  default_hourly_rate: number
  payment_terms_days: number
  tax_set_aside_percent: number
  tax_year_start_day: number
  tax_year_start_month: number
  invoice_prefix: string
  next_invoice_number: number
  quote_prefix: string
  next_quote_number: number
  logo_file: string
  business_plan_file: string
  business_plan_text: string
  business_plan_read_at: string | null
  chase_enabled: number
  chase_days: string
  created_at: string
  updated_at: string
}

function toSettings(row: SettingsRow): Settings {
  return {
    businessName: row.business_name,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    postcode: row.postcode,
    country: row.country,
    vatRegistered: row.vat_registered === 1,
    vatNumber: row.vat_number,
    vatRate: row.vat_rate,
    currency: row.currency,
    defaultHourlyRate: row.default_hourly_rate,
    paymentTermsDays: row.payment_terms_days,
    taxSetAsidePercent: row.tax_set_aside_percent,
    taxYearStartDay: row.tax_year_start_day,
    taxYearStartMonth: row.tax_year_start_month,
    invoicePrefix: row.invoice_prefix,
    nextInvoiceNumber: row.next_invoice_number,
    quotePrefix: row.quote_prefix,
    nextQuoteNumber: row.next_quote_number,
    chaseEnabled: row.chase_enabled === 1,
    chaseDays: row.chase_days,
    logoFile: row.logo_file,
    businessPlanFile: row.business_plan_file,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** camelCase field -> column, and how to coerce the value for SQLite. */
const COLUMNS: {
  [K in keyof BusinessSettings]: { column: string; toDb: (value: BusinessSettings[K]) => string | number }
} = {
  businessName: { column: 'business_name', toDb: String },
  contactName: { column: 'contact_name', toDb: String },
  email: { column: 'email', toDb: String },
  phone: { column: 'phone', toDb: String },
  addressLine1: { column: 'address_line1', toDb: String },
  addressLine2: { column: 'address_line2', toDb: String },
  city: { column: 'city', toDb: String },
  postcode: { column: 'postcode', toDb: String },
  country: { column: 'country', toDb: String },
  vatRegistered: { column: 'vat_registered', toDb: (v) => (v ? 1 : 0) },
  vatNumber: { column: 'vat_number', toDb: String },
  vatRate: { column: 'vat_rate', toDb: Number },
  currency: { column: 'currency', toDb: String },
  defaultHourlyRate: { column: 'default_hourly_rate', toDb: Number },
  paymentTermsDays: { column: 'payment_terms_days', toDb: Number },
  taxSetAsidePercent: { column: 'tax_set_aside_percent', toDb: Number },
  taxYearStartDay: { column: 'tax_year_start_day', toDb: Number },
  taxYearStartMonth: { column: 'tax_year_start_month', toDb: Number },
  invoicePrefix: { column: 'invoice_prefix', toDb: String },
  nextInvoiceNumber: { column: 'next_invoice_number', toDb: Number },
  quotePrefix: { column: 'quote_prefix', toDb: String },
  nextQuoteNumber: { column: 'next_quote_number', toDb: Number },
  chaseEnabled: { column: 'chase_enabled', toDb: (value: unknown) => (value ? 1 : 0) },
  chaseDays: { column: 'chase_days', toDb: String },
  logoFile: { column: 'logo_file', toDb: String },
  businessPlanFile: { column: 'business_plan_file', toDb: String }
}

export function getSettings(db: Database): Settings {
  const row = db.get<SettingsRow>('SELECT * FROM settings WHERE id = 1')
  if (!row) throw new Error('Settings row missing — the database did not migrate correctly')
  return toSettings(row)
}

/**
 * Update only the fields present in `patch`. Unknown keys are ignored rather
 * than trusted into SQL, so a malformed payload cannot reach the statement.
 */
export function updateSettings(db: Database, patch: Partial<BusinessSettings>): Settings {
  const assignments: string[] = []
  const values: (string | number)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const spec = COLUMNS[key as keyof BusinessSettings]
    if (!spec || value === undefined) continue
    assignments.push(`${spec.column} = ?`)
    values.push((spec.toDb as (v: unknown) => string | number)(value))
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE settings SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = 1`,
      values
    )
  }

  return getSettings(db)
}