import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import type { StyleProp, TextStyle, ViewStyle } from 'react-native'

import { MeScreen } from './me-screen'

const me = {
  id: '019c4ab8-ef80-7000-8000-000000000001',
  email: 'skater@example.com',
  displayName: 'Avery Skater',
  avatarUrl: null,
}

const baseProps = {
  baseUrl: 'https://api.puckflow.app',
  getToken: jest.fn(() => Promise.resolve('session-jwt')),
  onSignIn: jest.fn(),
}

function response(body: unknown, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response
}

describe('MeScreen', () => {
  it('labels profile loading for assistive technology', async () => {
    const screen = await render(
      <MeScreen {...baseProps} isLoaded={false} isSignedIn={undefined} />,
    )

    expect(screen.getByLabelText('Loading profile')).toBeTruthy()
  })

  it('exposes a 44-point native sign-in button', async () => {
    const onSignIn = jest.fn()
    const screen = await render(
      <MeScreen
        {...baseProps}
        isLoaded
        isSignedIn={false}
        onSignIn={onSignIn}
      />,
    )

    const button = screen.getByRole('button', { name: 'Sign in' })
    const buttonProps = button.props as { style?: StyleProp<ViewStyle> }
    expect(StyleSheet.flatten(buttonProps.style)?.minHeight).toBe(44)
    await fireEvent.press(button)
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it('uses the injected session token to request and render /v1/me', async () => {
    const fetch = jest.fn(() => Promise.resolve(response(me, 200)))
    const screen = await render(
      <MeScreen
        {...baseProps}
        isLoaded
        isSignedIn
        fetch={fetch as typeof globalThis.fetch}
      />,
    )

    expect(await screen.findByText(me.displayName)).toBeTruthy()
    expect(screen.getByText(me.email)).toBeTruthy()
    expect(screen.getByText(me.id)).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith('https://api.puckflow.app/v1/me', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer session-jwt',
      },
    })
    const displayNameProps = screen.getByText(me.displayName).props as {
      allowFontScaling?: boolean
    }
    expect(displayNameProps.allowFontScaling).toBe(true)
    for (const text of screen.container.queryAll(
      (node) => node.type === 'Text',
    )) {
      const textProps = text.props as { style?: StyleProp<TextStyle> }
      expect(StyleSheet.flatten(textProps.style)?.height).toBeUndefined()
    }
  })

  it('renders safe Problem Details and one new request on retry', async () => {
    const problem = {
      type: 'https://puckflow.app/problems/internal',
      title: 'Profile unavailable',
      status: 503,
      detail: 'Please try again.',
      code: 'INTERNAL',
      requestId: 'mobile-request-17',
      instance: '/v1/me',
    }
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(response(problem, 503))
      .mockResolvedValueOnce(response(me, 200))
    const screen = await render(
      <MeScreen
        {...baseProps}
        isLoaded
        isSignedIn
        fetch={fetch as typeof globalThis.fetch}
      />,
    )

    expect(await screen.findByText(problem.detail)).toBeTruthy()
    expect(screen.getByText(`Request ID: ${problem.requestId}`)).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Retry profile' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(me.displayName)).toBeTruthy()
  })
})
