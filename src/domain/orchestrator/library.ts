// Zod 4, which is what defineComponent requires — zod@3.25 ships it at this
// path alongside the v3 export every other file here still imports. The two
// coexist deliberately: only the component props need v4.
import { z } from 'zod/v4'
import { createLibrary, defineComponent } from '@openuidev/lang-core'
import { ALL_DOC_TYPES } from '../field-id'
import { ALL_COPY_IDS } from './copy'

/**
 * The set of things the agent is allowed to put on the applicant's screen,
 * and the only one. Every prop is an identifier — a copy id, a field id, a
 * document type — and never a string the model wrote. That is what keeps the
 * vetted-copy guarantee: the agent names a thing, and the catalog supplies
 * the words at render time.
 *
 * OpenUI enforces the component names for us (an unknown component is
 * dropped at parse) but NOT the prop values: a free-text string in a copyId
 * prop parses without error. `enforceTree` is what closes that, and the
 * schemas here are what it checks against.
 */

const Notice = defineComponent({
  name: 'Notice',
  description:
    'Show one piece of legally reviewed copy. The only argument is its id. '
    + 'You cannot write the words yourself.',
  props: z.object({ copyId: z.enum(ALL_COPY_IDS) }),
  component: 'notice',
})

const Ask = defineComponent({
  name: 'Ask',
  description:
    'Ask for one outstanding field, by id. The label, the reason and the '
    + 'input are all supplied for you. Asking for anything not listed as '
    + 'outstanding is refused.',
  props: z.object({ fieldId: z.string().min(1) }),
  component: 'field_ask',
})

const Why = defineComponent({
  name: 'Why',
  description: 'Explain why one field is required, by id. The explanation is supplied for you.',
  props: z.object({ fieldId: z.string().min(1) }),
  component: 'rationale',
})

const Doc = defineComponent({
  name: 'Doc',
  description: 'Ask for one document by type. Reading it fills in several fields at once.',
  props: z.object({ docType: z.enum(ALL_DOC_TYPES) }),
  component: 'document_request',
})

const Progress = defineComponent({
  name: 'Progress',
  description: 'Show how far along the application is.',
  props: z.object({ done: z.number().int().min(0), total: z.number().int().min(0) }),
  component: 'orientation',
})

const Turn = defineComponent({
  name: 'Turn',
  description: 'The whole reply. Everything you show goes in its children.',
  props: z.object({ children: z.array(z.any()) }),
  component: 'root',
})

export const BLOCK_COMPONENTS = { Turn, Notice, Ask, Why, Doc, Progress }

export const agentLibrary = createLibrary({
  id: 'iaa-registration',
  root: 'Turn',
  components: [Turn, Notice, Ask, Why, Doc, Progress],
})
