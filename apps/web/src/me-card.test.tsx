import { ApiProblemError } from '@puckflow/api-client'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MeCard } from './me-card.js'

const me = {
  id: '019c4ab8-ef80-7000-8000-000000000001',
  email: 'skater@example.com',
  displayName: 'Avery Skater',
  avatarUrl: 'https://images.example.test/avery.png',
}

describe('MeCard', () => {
  it('renders the signed-in identity with accessible avatar text', () => {
    const { unmount } = render(
      <MeCard initialMe={me} getMe={() => Promise.resolve(me)} />,
    )

    expect(screen.getByText('Signed in as')).toBeVisible()
    expect(screen.getByRole('heading', { name: me.displayName })).toBeVisible()
    expect(screen.getByText(me.email)).toBeVisible()
    expect(screen.getByText(me.id)).toBeVisible()
    expect(
      screen.getByRole('img', { name: `${me.displayName} avatar` }),
    ).toBeVisible()

    unmount()
    render(
      <MeCard
        initialMe={{ ...me, avatarUrl: null }}
        getMe={() => Promise.resolve(me)}
      />,
    )
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows a safe request ID and retries exactly once', async () => {
    const getMe = vi.fn().mockResolvedValue(me)
    const initialError = new ApiProblemError({
      code: 'INTERNAL',
      status: 503,
      detail: 'Profile service is unavailable.',
      requestId: 'web-request-17',
    })
    render(
      <MeCard
        initialError={{
          detail: initialError.message,
          requestId: initialError.requestId!,
        }}
        getMe={getMe}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(initialError.message)
    expect(screen.getByRole('alert')).toHaveTextContent('web-request-17')
    const retry = screen.getByRole('button', { name: 'Retry profile' })
    expect(retry).not.toHaveAttribute('tabindex', '-1')
    expect(retry).toHaveStyle({ minHeight: '44px', minWidth: '44px' })

    fireEvent.click(retry)

    await waitFor(() => expect(getMe).toHaveBeenCalledOnce())
    expect(
      await screen.findByRole('heading', { name: me.displayName }),
    ).toBeVisible()
  })

  it('does not render unrestricted errors returned by a retry', async () => {
    const getMe = vi
      .fn()
      .mockRejectedValue({ detail: 'session-jwt-do-not-render' })
    render(
      <MeCard
        initialError={{ detail: 'Profile service is unavailable.' }}
        getMe={getMe}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry profile' }))

    expect(
      await screen.findByText('Your profile is temporarily unavailable.'),
    ).toBeVisible()
    expect(screen.queryByText(/session-jwt-do-not-render/)).toBeNull()
  })
})
