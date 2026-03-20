export const CHANGE_EVENT_LOGGED = 'changelog.logged';

export interface ChangeEventPayload {
  id: number;
  entity: string;
  refId: string;
  action: string;
  userId: string;
}
