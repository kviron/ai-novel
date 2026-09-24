import { api } from '@/shared/api'

// Transport stays stateless; the page model owns cancellation and reconciliation.
export const storySessionApi = {
  load: api.getSession,
  providers: api.providers,
  submit: api.createTurn,
  rewind: api.rewind,
  changeModel: api.changeModel,
}
