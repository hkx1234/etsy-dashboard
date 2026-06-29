import api from './request'

export function register(data) {
  return api.post('/auth/register', data)
}

export function login(email, password, rememberMe = false) {
  return api.post('/auth/login', { email, password, remember_me: rememberMe })
}

export function getMe() {
  return api.get('/auth/me')
}

export function refresh(refreshToken) {
  return api.post('/auth/refresh', { refresh_token: refreshToken })
}

export function logoutApi(refreshToken) {
  return api.post('/auth/logout', { refresh_token: refreshToken })
}
