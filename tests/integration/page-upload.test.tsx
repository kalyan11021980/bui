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
import type { PreparedImage } from '@/ui/panel/prepare-image'

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
}

const BOX = [100, 200, 400, 260] as const

/**
 * The application as the server would return it after reading a licence.
 * Below the crop floor it records no box at all, so `placed` is false there.
 */
function withDlNumber(state: ApplicationState, placed = true): ApplicationState {
  return {
    ...state,
    fields: {
      ...state.fields,
      dl_number: {
        value: 'WDLJK00580GF',
        status: 'derived',
        provenance: {
          source: 'ocr', documentId: 'doc-1', confidence: 0.9,
          ...(placed && { box: BOX }),
        },
      },
    },
  }
}

type Call = { url: string; body: unknown }

let calls: Call[]
/** A string body is sent as-is, unparsed — Next answers a 500 with HTML. */
let respond: (call: Call) => { status: number; body: unknown }
/** Set to hold every action response open until the test lets it go. */
let holdActions: Promise<void> | null

const created = () => createApplication('app-1', PROFILE)

/** Everything the engine asks of this profile, answered and confirmed. */
function completed(): ApplicationState {
  const at = '2026-08-03T00:00:00.000Z'
  const answers: [RequirementKey, unknown][] = [
    ['primary_activity', 'dealer'], ['preferred_language', 'English'],
    ['first_name', 'Ada'], ['last_name', 'Lovelace'], ['dl_number', 'D1234567'],
    ['dl_expiry', '2030-04-30'], ['dob', '1982-08-31'], ['id_images', ['front.png']],
    ['id_country', 'US'], ['id_state', 'GA'],
    ['addr_line1', '2345 Anywhere St'], ['addr_city', 'Atlanta'],
    ['addr_state', 'GA'], ['addr_zip', '30301'], ['phone_mobile', '4045551234'],
  ]
  return answers.reduce(
    (state, [fieldId, value]) =>
      applicationReducer(state, { type: 'SET_VALUE', fieldId, value, source: 'user', at }),
    created(),
  )
}

beforeEach(() => {
  calls = []
  holdActions = null
  decoder.next = PREPARED
  respond = () => ({ status: 200, body: created() })

  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const call = { url, body: init.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    if (holdActions && url.endsWith('/actions')) await holdActions
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

const uploadPhoto = async () =>
  userEvent.upload(
    screen.getByLabelText(/photo of your/i),
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
    expect(screen.getByLabelText(/photo of your passport/i)).toBeInTheDocument()

    await userEvent.upload(
      screen.getByLabelText(/photo of your passport/i),
      new File(['x'], 'passport.png', { type: 'image/png' }),
    )
    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect((uploads()[0]?.body as { docType: string }).docType).toBe('passport')
  })

  it('fills the form in from the document, still asking the applicant to check it', async () => {
    respond = (call) =>
      call.url.endsWith('/documents')
        ? {
            status: 200,
            body: { band: 'full', filled: ['dl_number'], state: withDlNumber(created()) },
          }
        : { status: 200, body: created() }

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

  it('shows the part of the document each value was read from', async () => {
    respond = (call) =>
      call.url.endsWith('/documents')
        ? {
            status: 200,
            body: { band: 'full', filled: ['dl_number'], state: withDlNumber(created()) },
          }
        : { status: 200, body: created() }

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await uploadPhoto()

    const crop = await screen.findByRole('img', { name: /part of your document/i })
    const image = crop.querySelector('img')
    // The pixels the browser measured, clipped to the box the server returned.
    expect(image).toHaveAttribute('src', PREPARED.imageUrl)
    expect(image?.style.width).toBe(`${1560 * (260 / 300)}px`)
    expect(image?.style.left).toBe(`${-100 * (260 / 300)}px`)
  })

  it('says something true and calm when the reader is unreachable, and asks nothing again', async () => {
    // The route answers 500 deliberately, so an unset endpoint cannot pass for
    // an empty read. The applicant is not shown an error page for it.
    respond = (call) =>
      call.url.endsWith('/documents')
        ? { status: 500, body: { error: 'OCR_ENDPOINT and OCR_MODEL must both be set' } }
        : { status: 200, body: created() }

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
        : { status: 200, body: created() }

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
      return { status: 200, body: created() }
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
        : { status: 200, body: created() }

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await uploadPhoto()

    expect(await screen.findByText(/too small to read/i)).toBeInTheDocument()
  })

  it('says plainly when the document gave up nothing, without calling it a failure', async () => {
    respond = (call) =>
      call.url.endsWith('/documents')
        ? { status: 200, body: { band: 'full', filled: [], state: created() } }
        : { status: 200, body: created() }

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await uploadPhoto()

    expect(await screen.findByText(/could not read anything from that photo/i))
      .toHaveTextContent(/still yours to answer/i)
  })

  it('explains missing crops when the server is the one that says the card was small', async () => {
    // A big photo of a distant card reads fine and crops wrong, and the server
    // demotes it after the read. The client's own pre-flight never fires here,
    // so this sentence is the only place the applicant learns why.
    respond = (call) =>
      call.url.endsWith('/documents')
        ? {
            status: 200,
            body: {
              band: 'text-only', filled: ['dl_number'],
              state: withDlNumber(created(), false),
            },
          }
        : { status: 200, body: created() }

    render(<Page />)
    await screen.findByRole('region', { name: /your application/i })

    await uploadPhoto()

    const said = await screen.findByText(/we filled in 1 answer/i)
    expect(said).toHaveTextContent(/too small to show you where each answer came from/i)
  })

  it('takes down what it said about the last photo when a new one is chosen', async () => {
    // Seen in a browser: a failed read left its message standing under the
    // next photo's refusal, describing one the applicant had moved on from.
    respond = (call) =>
      call.url.endsWith('/documents')
        ? { status: 500, body: { error: 'boom' } }
        : { status: 200, body: created() }

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
        : { status: 200, body: created() }

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
            body: { band: 'full', filled: ['dl_number'], state: withDlNumber(created()) },
          }
        : { status: 200, body: created() }

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
    respond = () => ({ status: 200, body: { ...completed(), submittedAt: '2026-08-03T00:00:00.000Z' } })

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
    respond = () => ({ status: 200, body: { ...completed(), submittedAt: '2026-08-03T00:00:00.000Z' } })

    render(<Page />)
    await screen.findByText(/sent for review/i)

    expect(screen.getByLabelText(/photo of your/i)).toBeDisabled()
  })
})

describe('sending the application', () => {
  it('sends a complete application and tells the server, once', async () => {
    respond = () => ({ status: 200, body: completed() })

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
