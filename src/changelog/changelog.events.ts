export const CHANGE_EVENT_LOGGED = 'changelog.logged';

export interface ChangeEventPayload {
  entity: string;
  refId: string;
  action: string;
  userId: string;
}
