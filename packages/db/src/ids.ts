import { v7 } from 'uuid'

export function generateId(): string {
  return v7()
}
