import { StrictMode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Page from '@/app/page'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import { isComplete } from '@/domain/application/queries'
import type { ApplicationState } from '@/domain/application/state'
import type { RequirementKey } from '@/domain/requirements/key'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { Turn } from '@/domain/orchestrator/transcript'
import type { PreparedImage } from '@/ui/panel/prepare-image'
import { OWNER_TOKEN_HEADER } from '@/ui/client/application-api'

/**
 * The page, against a stubbed server. Everything below the fetch boundary is
 * covered by the route's own tests; what is only true here is the shape of
 * what the browser sends, and what an applicant is shown when it comes back.
 *
 * jsdom cannot decode an image, so the upload control's preparation step is
 * replaced — the same seam its own test uses.
 */

const PREPARED: PreparedImage = {
  imageBase64: 'cHJlcGFyZWQtYnl0ZXM=',
  imageUrl: 'data:image/jpeg;base64,cHJlcGFyZWQtYnl0ZXM=',
  imageSize: { width: 1560, height: 1006 },
}

/** A second, differently-sized document — a passport after a licence. */
const SECOND: PreparedImage = {
  imageBase64: 'b3RoZXI=',
  imageUrl: 'data:image/jpeg;base64,b3RoZXI=',
  imageSize: { width: 3024, height: 4032 },
}

/** Below the read floor: refused in the browser, never sent. */
const TOO_SMALL: PreparedImage = {
  imageBase64: 'dGlueQ==',
  imageUrl: 'data:image/jpeg;base64,dGlueQ==',
  imageSize: { width: 320, height: 206 },
}

const decoder = vi.hoisted(() => ({ next: null as unknown as { imageSize: unknown } }))
vi.mock('@/ui/panel/prepare-image', () => ({
  prepareImage: async () => decoder.next,
}))

const PROFILE: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
  bizCountry: null,
}

/**
 * The application as the server would return it after reading a licence.
 */
function withDlNumber(state: ApplicationState): ApplicationState {
  return {
    ...state,
    fields: {
      ...state.fields,
      dl_number: {
        value: 'WDLJK00580GF',
        status: 'derived',
        provenance: {
          source: 'ocr', documentId: 'doc-1', confidence: 0.9,
        },
      },
    },
  }
}

type Call = { url: string; body: unknown; token: string | null }

let calls: Call[]
/** A string body is sent as-is, unparsed — Next answers a 500 with HTML. */
let respond: (call: Call) => { status: number; body: unknown }
/** Set to hold every action response open until the test lets it go. */
let holdActions: Promise<void> | null
/**
 * One entry per `/documents` call, consumed in call order — so two reads in
 * flight at once can be released independently, not just held as a pair.
 */
let holdDocumentQueue: Array<Promise<void>>

const OWNER = 'owner-token-1'

/** The creation response — the only one that carries the token. */
const started = () => createApplication('app-1', PROFILE, OWNER)

/** The same application as every later response shows it: token stripped. */
const created = (): ApplicationState => ({ ...started(), ownerToken: null })

/** A server that hands the token out once and expects it back after that. */
const asServer = (call: Call) => ({
  status: 200,
  body: call.url === '/api/application' ? started() : created(),
})

/** A server that takes the document and reads nothing out of it. */
const readNothing = (call: Call) =>
  call.url.endsWith('/documents')
    ? {
        status: 200,
        body: { band: 'text-only', documentId: 'doc-1', filled: [], state: created() },
      }
    : asServer(call)

/** The same, for a server that answers with one particular application. */
const serving = (state: ApplicationState) => (call: Call) => ({
  status: 200,
  body: call.url === '/api/application' ? { ...state, ownerToken: OWNER } : state,
})

/** Everything the engine asks of this profile, answered and confirmed. */
function completed(): ApplicationState {
  const at = '2026-08-03T00:00:00.000Z'
  const answers: [RequirementKey, unknown][] = [
    ['applicant_type', 'individual'], ['location_country', 'USA'],
    ['location_state', 'GA'], ['id_form', 'drivers_license'],
    ['address_differs', 'no'], ['wants_gsa', 'no'],
    ['primary_activity', 'dealer'], ['preferred_language', 'English'],
    ['first_name', 'Ada'], ['last_name', 'Lovelace'], ['dl_number', 'D1234567'],
    ['dl_expiry', '2030-04-30'], ['dob', '1982-08-31'], ['id_images', ['front.png']],
    ['id_country', 'USA'], ['id_state', 'GA'],
    ['addr_line1', '2345 Anywhere St'], ['addr_city', 'Atlanta'],
    ['addr_state', 'GA'], ['addr_zip', '30301'],
    ['phone_primary', '4045551234'], ['phone_mobile', '4045551234'],
  ]
  return answers.reduce(
    (state, [fieldId, value]) =>
      applicationReducer(state, { type: 'SET_VALUE', fieldId, value, source: 'user', at }),
    created(),
  )
}

beforeEach(() => {
  // The panel is a debug view now — the page renders it only behind ?debug.
  // Everything below asserts on panel rows and the document dropzone, so it
  // is the debug page under test here, not the applicant's chat.
  window.history.replaceState({}, '', '/?debug')
  calls = []
  holdActions = null
  holdDocumentQueue = []
  decoder.next = PREPARED
  respond = asServer

  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const call = {
      url,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      token: new Headers(init.headers).get(OWNER_TOKEN_HEADER),
    }
    calls.push(call)
    if (holdActions && url.endsWith('/actions')) await holdActions
    if (url.endsWith('/documents')) {
      const hold = holdDocumentQueue.shift()
      if (hold) await hold
    }

    // What the real server does with a caller who cannot produce the token:
    // 404, the same answer an id that does not exist gets. Every test below
    // therefore only passes while the page presents it.
    if (url !== '/api/application' && call.token !== OWNER) {
      return new Response(JSON.stringify({ error: 'unknown application' }), {
        status: 404, headers: { 'content-type': 'application/json' },
      })
    }

    // Throwing here is a request that never reached a server.
    const { status, body } = respond(call)
    const html = typeof body === 'string'
    return new Response(html ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': html ? 'text/html' : 'application/json' },
    })
  })
})

afterEach(() => { vi.unstubAllGlobals() })

// The debug panel's own DocumentUpload input — id="upload-<docType>", never
// scoped. The chat composer's attach control now answers to the same label
// text when exactly one document is outstanding (§Task 5), so a bare
// getByLabelText(/photo of your/i) is ambiguous; this is the debug panel's.
const PANEL_UPLOAD = { selector: 'input[id^="upload-"]' }

const uploadPhoto = async () =>
  userEvent.upload(
    screen.getByLabelText(/photo of your/i, PANEL_UPLOAD),
    new File(['x'], 'licence.png', { type: 'image/png' }),
  )

const uploads = () => calls.filter((c) => c.url.endsWith('/documents'))
const actions = () => calls.filter((c) => c.url.endsWith('/actions'))

describe('the page', () => {
  it('starts a real application on the server rather than inventing an id', async () => {
    render(<Page />)

    await screen.findByRole('region', { name: /your application/i })
    expect(calls[0]?.url).toBe('/api/application')
    // The id in every later call is the server's, not a placeholder.
    await uploadPhoto()
    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect(uploads()[0]?.url).toBe('/api/application/app-1/documents')
  })

  it('sends the bare base64 payload and nothing the route would refuse', async () => {
    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await uploadPhoto()

    await waitFor(() => expect(uploads()).toHaveLength(1))
    // No imageSize: the route is strict, and derives the size from the bytes.
    // The payload is bare — a data: URL has its own refusal on the route.
    expect(uploads()[0]?.body).toEqual({
      docType: 'drivers_license',
      imageBase64: 'cHJlcGFyZWQtYnl0ZXM=',
    })
  })

  it('asks for the document the applicant said they hold', async () => {
    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await userEvent.selectOptions(screen.getByLabelText(/id form/i), 'passport')
    expect(screen.getByLabelText(/photo of your passport/i, PANEL_UPLOAD)).toBeInTheDocument()

    await userEvent.upload(
      screen.getByLabelText(/photo of your passport/i, PANEL_UPLOAD),
      new File(['x'], 'passport.png', { type: 'image/png' }),
    )
    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect((uploads()[0]?.body as { docType: string }).docType).toBe('passport')
  })

  it('asks for a dealer licence once the applicant says they hold one', async () => {
    // The route has always taken all five document types; the page offered
    // three, so a business applicant could not upload the one document that
    // fills their licence and business fields at all.
    respond = readNothing
    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })
    expect(screen.queryByLabelText(/photo of your dealer license/i)).toBeNull()

    await userEvent.selectOptions(screen.getByLabelText(/applicant/i), 'business')
    await userEvent.selectOptions(screen.getByLabelText(/licences/i), '1')

    // Both, not one instead of the other: the licence proves the business,
    // the ID proves the person holding it.
    expect(screen.queryByLabelText(/photo of your driver's license/i)).toBeInTheDocument()
    const dealer = screen.queryByLabelText(/photo of your dealer license/i)
    expect(dealer).toBeInTheDocument()
    await userEvent.upload(dealer!, new File(['x'], 'dealer.png', { type: 'image/png' }))

    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect((uploads()[0]?.body as { docType: string }).docType).toBe('dealer_license')
  })

  it('asks for proof of address only when the address is not the one on the ID', async () => {
    respond = readNothing
    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })
    expect(screen.queryByLabelText(/photo of your proof of address/i)).toBeNull()

    await userEvent.click(screen.getByLabelText(/address differs from id/i))

    expect(screen.queryByLabelText(/photo of your driver's license/i)).toBeInTheDocument()
    const proof = screen.queryByLabelText(/photo of your proof of address/i)
    expect(proof).toBeInTheDocument()
    await userEvent.upload(proof!, new File(['x'], 'bill.png', { type: 'image/png' }))

    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect((uploads()[0]?.body as { docType: string }).docType).toBe('proof_of_residency')
  })

  it('fills the form in from the document, still asking the applicant to check it', async () => {
    respond = (call) =>
      call.url.endsWith('/documents')
        ? {
            status: 200,
            body: {
              band: 'text-only', documentId: 'doc-1', filled: ['dl_number'],
              state: withDlNumber(created()),
            },
          }
        : asServer(call)

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await uploadPhoto()

    const row = await screen.findByRole('group', { name: /driver's license number/i })
    // In the box, editable — a read value is a draft answer, not a verdict.
    expect(within(row).getByLabelText(/driver's license number/i, {
      selector: 'input, select, textarea',
    })).toHaveValue('WDLJK00580GF')
    expect(row).toHaveTextContent(/from your document/i)
    // Read, not accepted: it is still on the applicant to say so.
    expect(within(row).getByRole('button', { name: /looks right/i })).toBeInTheDocument()
    expect(await screen.findByText(/we filled in 1 answer/i)).toBeInTheDocument()
  })

  it('presents the group in the chat after an upload at the opening — no prior typing', async () => {
    // Regression test for the reported bug: an upload used to fill fields with
    // nothing on screen to act on — no group, no field cards, no Done bar.
    // The chat, not the debug panel, is under test here.
    window.history.replaceState({}, '', '/')

    const presentingTurn: Turn = {
      seq: 1, at: '2026-08-06T00:00:00.000Z', role: 'agent', voice: null,
      blocks: [
        { kind: 'section_header', section: 'identification', done: 0, total: 1 },
        { kind: 'field_ask', fieldId: 'dl_number' },
      ],
    }
    respond = (call) =>
      call.url.endsWith('/documents')
        ? {
            status: 200,
            body: {
              band: 'text-only', documentId: 'doc-1', filled: ['dl_number'],
              state: { ...withDlNumber(created()), transcript: [presentingTurn] },
            },
          }
        : asServer(call)

    render(<Page />)
    await screen.findByRole('region', { name: /registration agent/i })

    await userEvent.upload(
      screen.getByLabelText(/upload photo/i),
      new File(['x'], 'licence.png', { type: 'image/png' }),
    )

    const row = await screen.findByRole('group', { name: /driver's license number/i })
    expect(within(row).getByRole('button', { name: /looks right/i })).toBeInTheDocument()
    expect(screen.getByText(/identification/i)).toBeInTheDocument()
    // The third symptom in the report: no Done bar either.
    expect(screen.getByRole('button', { name: /done with this section/i })).toBeInTheDocument()
  })

  it('presents the group once under StrictMode — the double-invoked ingest effect stays idempotent', async () => {
    // StrictMode double-invokes effects. ConversationShell's ingest effect
    // dedupes on the transcript's own seq, but this pins that down against
    // the presenting turn actually being appended twice into the log.
    window.history.replaceState({}, '', '/')

    const presentingTurn: Turn = {
      seq: 1, at: '2026-08-06T00:00:00.000Z', role: 'agent', voice: null,
      blocks: [
        { kind: 'section_header', section: 'identification', done: 0, total: 1 },
        { kind: 'field_ask', fieldId: 'dl_number' },
      ],
    }
    respond = (call) =>
      call.url.endsWith('/documents')
        ? {
            status: 200,
            body: {
              band: 'text-only', documentId: 'doc-1', filled: ['dl_number'],
              state: { ...withDlNumber(created()), transcript: [presentingTurn] },
            },
          }
        : asServer(call)

    render(<StrictMode><Page /></StrictMode>)
    await screen.findByRole('region', { name: /registration agent/i })

    await userEvent.upload(
      screen.getByLabelText(/upload photo/i),
      new File(['x'], 'licence.png', { type: 'image/png' }),
    )

    await screen.findByRole('group', { name: /driver's license number/i })
    expect(screen.getAllByRole('group', { name: /driver's license number/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /done with this section/i })).toHaveLength(1)
  })

  it('shows a reading-photo status while the OCR read is in flight, and clears it after', async () => {
    // The read takes multiple seconds against a real endpoint. Held open here
    // so the in-flight window — including the queue wait, not just the fetch
    // itself — has something to assert on before it is let go.
    let release = () => undefined as void
    holdDocumentQueue = [new Promise<void>((resolve) => { release = () => resolve() })]
    respond = readNothing

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await uploadPhoto()

    expect(await screen.findByText(/reading your photo/i)).toBeInTheDocument()

    release()

    await waitFor(() => expect(screen.queryByText(/reading your photo/i)).toBeNull())
  })

  it('keeps the reading-photo line up while a second read overlaps the first', async () => {
    // Reachable through an ordinary action: two documents are outstanding at
    // once (licence + proof of address), and nothing here disables either
    // input mid-read, so a second photo can be chosen before the first read
    // has come back. A flag that only tracked "is any read open" (rather
    // than counting them) would clear the moment the first one settles, even
    // though the second is still running — this is the gap that closes.
    let releaseA = () => undefined as void
    const heldA = new Promise<void>((resolve) => { releaseA = () => resolve() })
    let releaseB = () => undefined as void
    const heldB = new Promise<void>((resolve) => { releaseB = () => resolve() })
    holdDocumentQueue = [heldA, heldB]

    let seenDocs = 0
    respond = (call) => {
      if (!call.url.endsWith('/documents')) return asServer(call)
      seenDocs += 1
      return seenDocs === 1
        ? {
            status: 200,
            body: { band: 'text-only', documentId: 'doc-1', filled: ['dl_number'], state: withDlNumber(created()) },
          }
        : { status: 200, body: { band: 'text-only', documentId: 'doc-2', filled: [], state: created() } }
    }

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await userEvent.click(screen.getByLabelText(/address differs from id/i))
    const licenseInput = screen.getByLabelText(/photo of your driver's license/i, PANEL_UPLOAD)
    const proofInput = screen.getByLabelText(/photo of your proof of address/i, PANEL_UPLOAD)

    await userEvent.upload(licenseInput, new File(['x'], 'licence.png', { type: 'image/png' }))
    expect(await screen.findByText(/reading your photo/i)).toBeInTheDocument()

    // The second read starts before the first has resolved.
    await userEvent.upload(proofInput, new File(['y'], 'bill.png', { type: 'image/png' }))

    releaseA()
    await screen.findByRole('group', { name: /driver's license number/i })
    // A settled; B is still open — the line must not have cleared early.
    expect(screen.getByText(/reading your photo/i)).toBeInTheDocument()

    releaseB()
    await waitFor(() => expect(screen.queryByText(/reading your photo/i)).toBeNull())
  })

  it('clears the reading-photo status on a failed read too, not only a successful one', async () => {
    let release = () => undefined as void
    holdDocumentQueue = [new Promise<void>((resolve) => { release = () => resolve() })]
    respond = (call) =>
      call.url.endsWith('/documents')
        ? { status: 500, body: { error: 'boom' } }
        : asServer(call)

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await uploadPhoto()

    expect(await screen.findByText(/reading your photo/i)).toBeInTheDocument()

    release()

    await waitFor(() => expect(screen.queryByText(/reading your photo/i)).toBeNull())
  })

  it('says something true and calm when the reader is unreachable, and asks nothing again', async () => {
    // The route answers 500 deliberately, so an unset endpoint cannot pass for
    // an empty read. The applicant is not shown an error page for it.
    respond = (call) =>
      call.url.endsWith('/documents')
        ? { status: 500, body: { error: 'OCR_ENDPOINT and OCR_MODEL must both be set' } }
        : asServer(call)

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await uploadPhoto()

    const said = await screen.findByText(/could not read your document/i)
    expect(said).toHaveTextContent(/nothing is lost/i)
    // Not the server's words, and no code.
    expect(said).not.toHaveTextContent(/OCR_ENDPOINT|500/)
    // Every field is still the applicant's to fill in.
    const input = screen.getByLabelText(/driver's license number/i, {
      selector: 'input, select, textarea',
    })
    expect(input).toBeEnabled()
    await userEvent.type(input, 'D1234567')
    expect(input).toHaveValue('D1234567')
  })

  it('stays calm when the 500 is an HTML error page, which is what Next sends', async () => {
    // The shape production actually produces. Every other test here stubs a
    // JSON body, so the guard that keeps `response.json()` from throwing was
    // never travelled by a test at all.
    respond = (call) =>
      call.url.endsWith('/documents')
        ? { status: 500, body: '<!DOCTYPE html><html><body>Internal Server Error</body></html>' }
        : asServer(call)

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await uploadPhoto()

    expect(await screen.findByText(/could not read your document/i))
      .toHaveTextContent(/nothing is lost/i)
    expect(screen.queryByText(/DOCTYPE|Internal Server Error/)).toBeNull()
  })

  it('says the same thing when the request never reaches a server at all', async () => {
    // No response, so no status and no message to pass on: offline and a 500
    // are one story to the applicant, and both leave the form to them.
    respond = (call) => {
      if (call.url.endsWith('/documents')) throw new TypeError('Failed to fetch')
      return asServer(call)
    }

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await uploadPhoto()

    expect(await screen.findByText(/could not read your document/i))
      .toHaveTextContent(/nothing is lost/i)
  })

  it('passes a refusal on in the words the route chose', async () => {
    respond = (call) =>
      call.url.endsWith('/documents')
        ? { status: 422, body: { error: 'That photo is too small to read.' } }
        : asServer(call)

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await uploadPhoto()

    expect(await screen.findByText(/too small to read/i)).toBeInTheDocument()
  })

  it('says plainly when the document gave up nothing, without calling it a failure', async () => {
    respond = (call) =>
      call.url.endsWith('/documents')
        ? { status: 200, body: { band: 'text-only', documentId: 'doc-1', filled: [], state: created() } }
        : asServer(call)

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await uploadPhoto()

    expect(await screen.findByText(/could not read anything from that photo/i))
      .toHaveTextContent(/still yours to answer/i)
  })

  it('does not call a text-only read "too small" — the photo may be full-size', async () => {
    // Mistral OCR returns no bounding boxes, so every read lands in the
    // text-only band whatever the photo size. The notice must not claim the
    // photo was too small to crop: that was only true when crops existed, and
    // a full-size photo reads at text-only just the same.
    respond = (call) =>
      call.url.endsWith('/documents')
        ? {
            status: 200,
            body: {
              band: 'text-only', documentId: 'doc-1', filled: ['dl_number'],
              state: withDlNumber(created()),
            },
          }
        : asServer(call)

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await uploadPhoto()

    const said = await screen.findByText(/we filled in 1 answer/i)
    expect(said).not.toHaveTextContent(/too small to show/i)
  })

  it('takes down what it said about the last photo when a new one is chosen', async () => {
    // Seen in a browser: a failed read left its message standing under the
    // next photo's refusal, describing one the applicant had moved on from.
    respond = (call) =>
      call.url.endsWith('/documents')
        ? { status: 500, body: { error: 'boom' } }
        : asServer(call)

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await uploadPhoto()
    await screen.findByText(/could not read your document/i)

    // The next photo never reaches the server, so nothing else would clear it.
    decoder.next = TOO_SMALL
    await uploadPhoto()

    expect(await screen.findByText(/too small to read/i)).toBeInTheDocument()
    expect(screen.queryByText(/could not read your document/i)).toBeNull()
    expect(uploads()).toHaveLength(1)
  })

  it('tells the server about a typed answer, and says so when it could not', async () => {
    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await userEvent.type(
      screen.getByLabelText(/first name/i, { selector: 'input, select, textarea' }),
      'Ada',
    )

    // One per keystroke: each prefix is a value the field's own schema accepts.
    await waitFor(() => expect(actions()).toHaveLength(3))
    expect(actions().at(-1)?.body).toMatchObject({
      action: { type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada', source: 'user' },
    })
    expect(screen.queryByText(/has not been saved/i)).toBeNull()
  })

  it('warns when an answer did not reach the server, rather than losing it quietly', async () => {
    respond = (call) =>
      call.url.endsWith('/actions')
        ? { status: 422, body: { error: 'refused' } }
        : asServer(call)

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await userEvent.type(
      screen.getByLabelText(/first name/i, { selector: 'input, select, textarea' }),
      'Ada',
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(/has not been saved/i)
    // The answer stays on screen: it is the applicant's, and the panel alone
    // can complete an application.
    expect(screen.getByLabelText(/first name/i, {
      selector: 'input, select, textarea',
    })).toHaveValue('Ada')
  })

  it('waits for the answers to land before sending the photo', async () => {
    // The reply is adopted whole. Sent while an answer is still in flight, it
    // would be built from an application that had not heard about it yet, and
    // the applicant would watch their own typing disappear.
    let release = () => undefined as void
    holdActions = new Promise<void>((resolve) => { release = () => resolve() })

    respond = (call) =>
      call.url.endsWith('/documents')
        ? {
            status: 200,
            body: {
              band: 'text-only', documentId: 'doc-1', filled: ['dl_number'],
              state: withDlNumber(created()),
            },
          }
        : asServer(call)

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await userEvent.type(
      screen.getByLabelText(/first name/i, { selector: 'input, select, textarea' }),
      'Ada',
    )
    await uploadPhoto()

    // The answers are still open, so the photo has not gone anywhere.
    expect(actions()).not.toHaveLength(0)
    expect(uploads()).toHaveLength(0)

    release()

    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect(calls.map((c) => c.url.replace('/api/application/app-1', ''))).toEqual([
      '/api/application', '/actions', '/actions', '/actions', '/documents',
    ])
  })

  it('says when it could not start the application at all', async () => {
    respond = () => ({ status: 500, body: { error: 'boom' } })

    render(<Page />)

    expect(await screen.findByText(/could not start your application/i)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /your application/i })).toBeNull()
  })

  it('starts one application, not one per render pass', async () => {
    // Strict mode runs effects twice. A second application is a second
    // abandoned record, and the first one's id is the one already on screen.
    render(<StrictMode><Page /></StrictMode>)

    await screen.findByRole('region', { name: /your application/i })
    expect(calls.filter((c) => c.url === '/api/application')).toHaveLength(1)
  })
})

describe('an application that has been sent for review', () => {
  it('offers no more edits, and says why', async () => {
    respond = serving({ ...completed(), submittedAt: '2026-08-03T00:00:00.000Z' })

    render(<Page />)

    expect(await screen.findByText(/sent for review/i))
      .toHaveTextContent(/can no longer be changed/i)
    // Nothing to type into and nothing to confirm: the reducer would refuse
    // both, so the panel must stop offering them.
    expect(screen.queryByLabelText(/first name/i, {
      selector: 'input, select, textarea',
    })).toBeNull()
    expect(screen.queryByRole('button', { name: /looks right/i })).toBeNull()
  })

  it('stops taking documents, which the route would refuse anyway', async () => {
    respond = serving({ ...completed(), submittedAt: '2026-08-03T00:00:00.000Z' })

    render(<Page />)
    await screen.findByText(/sent for review/i)

    expect(screen.getByLabelText(/photo of your/i, PANEL_UPLOAD)).toBeDisabled()
  })
})

describe('sending the application', () => {
  it('sends a complete application and tells the server, once', async () => {
    respond = serving(completed())

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })
    // Guards the fixture: a state that was not complete would make the
    // assertions below pass for the wrong reason.
    expect(isComplete(completed())).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: /submit/i }))

    expect(await screen.findByText(/sent for review/i)).toBeInTheDocument()
    await waitFor(() => expect(actions()).toHaveLength(1))
    expect(actions()[0]?.body).toMatchObject({ action: { type: 'SUBMIT' } })
  })

  it('refuses an incomplete application by naming what is missing, not by throwing', async () => {
    // The reducer answers an incomplete SUBMIT by throwing. That is a
    // developer's message, and it must not be what the applicant meets — so
    // the escaping error is asserted on, not only its absence of effect.
    const escaped: unknown[] = []
    const catchError = (event: ErrorEvent) => {
      escaped.push(event.error ?? event.message)
      event.preventDefault()
    }
    window.addEventListener('error', catchError)

    try {
      render(<Page />)
      await screen.findByRole('region', { name: /your application/i })

      await userEvent.click(screen.getByRole('button', { name: /submit/i }))

      expect(await screen.findByText(/not sent yet/i)).toHaveTextContent(/still needed above/i)
      expect(escaped).toEqual([])
      expect(actions()).toHaveLength(0)
      expect(screen.queryByText(/sent for review/i)).toBeNull()
    } finally {
      window.removeEventListener('error', catchError)
    }
  })
})
