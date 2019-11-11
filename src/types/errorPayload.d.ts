export interface ErrorPayload {
  worker: string;
  queue: string;
  payload: {
    class: string;
    args: Array<any>;
  };
  exception: string;
  error: string;
  backtrace: Array<string>;
  failed_at: string | number;
}
