import api from './request'

export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me')
}

export const adminApi = {
  list: (params) => api.get('/admins', { params }),
  detail: (id) => api.get(`/admins/${id}`),
  create: (data) => api.post('/admins', data),
  update: (id, data) => api.put(`/admins/${id}`, data),
  delete: (id) => api.delete(`/admins/${id}`)
}
