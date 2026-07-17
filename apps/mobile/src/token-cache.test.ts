import * as SecureStore from 'expo-secure-store'

import { tokenCache } from './token-cache'

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn(() => Promise.resolve()),
  getItemAsync: jest.fn(() => Promise.resolve('cached-token')),
  setItemAsync: jest.fn(() => Promise.resolve()),
}))

describe('Clerk token cache', () => {
  it('reads, writes, and deletes tokens only through SecureStore', async () => {
    await expect(tokenCache.getToken('clerk-session')).resolves.toBe(
      'cached-token',
    )
    await tokenCache.saveToken('clerk-session', 'new-token')
    await tokenCache.saveToken('clerk-session', '')

    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('clerk-session')
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'clerk-session',
      'new-token',
    )
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('clerk-session')
  })
})
