export enum LocalStorageKey {
  USER = 'user',
}

export const setToLocalStorage = (key: string, value: any): void => {
  if (typeof value === 'object') {
    localStorage.setItem(key, JSON.stringify(value))
  } else {
    localStorage.setItem(key, value)
  }
}

export const getFromLocalStorage = (key: string): any => {
  const item = localStorage.getItem(key)
  if (!item) return ''
  try {
    return JSON.parse(item)
  } catch {
    return item
  }
}

export const removeFromLocalStorage = (key: string): void => {
  localStorage.removeItem(key)
}

export const clearLocalStorage = (): void => {
  localStorage.clear()
}
