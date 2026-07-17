'use client'

import type { Me } from '@puckflow/core'
import { uiTokens } from '@puckflow/ui-tokens'
import { useState } from 'react'

type MeCardProps = {
  initialMe?: Me
  initialError?: MeCardError
  getMe: () => Promise<MeCardResult>
}

export type MeCardError = {
  detail: string
  requestId?: string
}

export type MeCardResult =
  { ok: true; me: Me } | { ok: false; error: MeCardError }

type CardState =
  | { status: 'ready'; me: Me }
  | { status: 'error'; error: MeCardError }
  | { status: 'loading'; error: MeCardError }

export function MeCard({ initialMe, initialError, getMe }: MeCardProps) {
  const [state, setState] = useState<CardState>(() => {
    if (initialMe) return { status: 'ready', me: initialMe }
    return {
      status: 'error',
      error: initialError ?? {
        detail: 'Your profile is temporarily unavailable.',
      },
    }
  })

  async function retry() {
    if (state.status === 'ready' || state.status === 'loading') return
    setState({ status: 'loading', error: state.error })
    try {
      const result = await getMe()
      setState(
        result.ok
          ? { status: 'ready', me: result.me }
          : { status: 'error', error: result.error },
      )
    } catch {
      setState({
        status: 'error',
        error: { detail: 'Your profile is temporarily unavailable.' },
      })
    }
  }

  if (state.status === 'ready') {
    const { me } = state
    return (
      <article className="me-card" aria-labelledby="profile-name">
        {me.avatarUrl ? (
          <img
            className="avatar"
            src={me.avatarUrl}
            alt={`${me.displayName} avatar`}
            width={88}
            height={88}
          />
        ) : null}
        <p className="eyebrow">Signed in as</p>
        <h1 id="profile-name">{me.displayName}</h1>
        <p>{me.email}</p>
        <dl>
          <dt>Internal user ID</dt>
          <dd>{me.id}</dd>
        </dl>
      </article>
    )
  }

  return (
    <article
      className="me-card error-card"
      aria-busy={state.status === 'loading'}
    >
      <div role="alert" aria-live="polite">
        <h1>Profile unavailable</h1>
        <p>{state.error.detail}</p>
        {state.error.requestId ? (
          <p className="request-id">Request ID: {state.error.requestId}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => void retry()}
        disabled={state.status === 'loading'}
        style={{
          minHeight: uiTokens.mobile.minimumTarget,
          minWidth: uiTokens.mobile.minimumTarget,
        }}
      >
        {state.status === 'loading' ? 'Retrying…' : 'Retry profile'}
      </button>
    </article>
  )
}
