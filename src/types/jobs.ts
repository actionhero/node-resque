import { Job } from "./job";

export interface Jobs {
  [jobName: string]: Job<any>;
}
