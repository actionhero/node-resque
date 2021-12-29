// Simple plugin to prevent all jobs
import { Plugin } from "../../src";

export class CustomPlugin extends Plugin {
  async beforeEnqueue() {
    return false;
  }

  async beforeDelayEnqueue() {
    return false;
  }

  async afterEnqueue() {
    return false;
  }

  async afterDelayEnqueue() {
    return false;
  }

  async beforePerform() {
    return false;
  }

  async afterPerform() {
    return false;
  }
}

export class HooksPlugin extends Plugin {
  async beforeEnqueue() {
    return true;
  }

  async beforeDelayEnqueue() {
    return true;
  }

  async afterEnqueue() {
    return true;
  }

  async afterDelayEnqueue() {
    return true;
  }

  async beforePerform() {
    return true;
  }

  async afterPerform() {
    return true;
  }
}
