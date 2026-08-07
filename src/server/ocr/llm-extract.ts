import { generateText } from 'ai'
import { ALL_FIELDS } from '@/domain/catalog'
import { glyphAmbiguity, NO_EVIDENCE, type Candidate } from '@/domain/ocr/extract'
import type { DocType } from '@/domain/field-id'
import { resolveModel } from '../orchestrator/model'

/**
 * Field extraction from OCR markdown by the chat model. Mistral OCR reads the
 * document into markdown without bounding boxes, so the grounding-box
 * strategies have nothing to anchor to — the model reads the markdown and
 * answers with the catalog fields it can see. What a document may prove is
 * still the catalog's call: keys the model offers outside `derivableFrom`
 * are dropped here.
 */

export type FieldExtractor = (docType: DocType, text: string) => Promise<readonly Candidate[]>

export async function extractFields(
  complete: (prompt: string) => Promise<string>,
  docType: DocType,
  text: string,
): Promise<Candidate[]> {
  const allowed = ALL_FIELDS.filter(
    (f) => f.derivableFrom?.includes(docType) && f.type !== 'file',
  )
  if (allowed.length === 0 || text.trim() === '') return []

  const fields = allowed.map((f) => `- ${f.id}: ${f.label}`).join('\n')
  const prompt = [
    `You are reading OCR markdown of an identity or business document of type "${docType}".`,
    'Extract values for these fields, and only these fields:',
    fields,
    'Rules:',
    '- Dates must be ISO format YYYY-MM-DD.',
    '- Answer with a strict JSON object mapping field id to string value.',
    '- Include only fields actually present on the document.',
    '- No markdown fences, no commentary.',
    '',
    'OCR markdown:',
    text,
  ].join('\n')

  const answer = await complete(prompt)

  // A malformed model answer is a read of nothing — the upload is still
  // recorded — not a crash.
  let parsed: unknown
  try {
    parsed = JSON.parse(answer.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''))
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return []

  const keys = new Set(allowed.map((f) => f.id as string))
  const candidates: Candidate[] = []
  for (const [key, value] of Object.entries(parsed)) {
    // The derivable contract is the catalog's call, not the model's.
    if (!keys.has(key)) continue
    if (typeof value !== 'string' || value.trim() === '') continue
    const raw = value.trim()
    candidates.push({
      key,
      raw,
      evidence: { ...NO_EVIDENCE, glyphAmbiguous: glyphAmbiguity(key, raw) },
    })
  }
  return candidates
}

export function envExtractor(): FieldExtractor {
  const model = resolveModel(process.env)
  // Deterministic: same document in, same fields out.
  const complete = async (prompt: string) =>
    (await generateText({ model, prompt, temperature: 0 })).text
  return (docType, text) => extractFields(complete, docType, text)
}
