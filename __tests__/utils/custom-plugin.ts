// Simple plugin to prevent all jobs
import { Plugin } from "../../src";

export class CustomPlugin extends Plugin {
  async beforeEnqueue() {
    return false;
  }

  async afterEnqueue() {
    return false;
  }

  async beforePerform() {
    return false;
  }

  async afterPerform() {
    return false;
  }
}
