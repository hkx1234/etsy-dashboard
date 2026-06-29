import api from './request'

export function getProfile() {
  return api.get('/auth/me')
}
