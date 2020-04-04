import { EventEmitter } from "events";

/**
 * This adds addSubscriber() to EventEmitter class:
 * @see https://nodejs.org/api/events.html
 */
export class SubscribingEventEmitter extends EventEmitter {
  async addSubscriber(subscriber: any) {
    let subscribedEvents = subscriber.getSubscribedEvents();
    for (let [event, listener] of Object.entries(subscribedEvents)) {
      // @ts-ignore
      this.on(event, listener);
    }
  }
}
