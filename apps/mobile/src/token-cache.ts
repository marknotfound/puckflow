import type { TokenCache } from '@clerk/expo/types'
import * as SecureStore from 'expo-secure-store'

export const tokenCache: TokenCache = {
  getToken(key) {
    return SecureStore.getItemAsync(key)
  },
  async saveToken(key, token) {
    if (token) {
      await SecureStore.setItemAsync(key, token)
      return
    }
    await SecureStore.deleteItemAsync(key)
  },
  clearToken(key) {
    return SecureStore.deleteItemAsync(key)
  },
}
