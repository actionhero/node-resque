import { EventEmitter } from "events";

/**
 * This adds addSubscriber() to EventEmitter class:
 * @see https://nodejs.org/api/events.html
 */
export class SubscribingEventEmitter extends EventEmitter {
  /**
   * Add listeners to current class from a class "subscriber".
   *
   * The class must provide getSubscribedEvents() method
   * that returns array of event name and listener pairs:
   *
   * getSubscribedEvents() {
   *   return {
   *      // this will subscribe to "example" event
   *      "example": () => console.log("handler for exaple event called"),
   *   };
   * }
   *
   */
  async addSubscriber(subscriber: any) {
    let subscribedEvents = subscriber.getSubscribedEvents();
    for (let [event, listener] of Object.entries(subscribedEvents)) {
      // @ts-ignore
      this.on(event, listener);
    }
  }
}
