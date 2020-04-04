import { SubscribingEventEmitter } from "../../src/utils/SubscribingEventEmitter";

class Worker extends SubscribingEventEmitter {}

class Subscriber {
  /**
   * counter for invocations
   */
  public events = {
    function: 0,
  };

  getSubscribedEvents() {
    return {
      function: () => this.events["function"]++,
    };
  }
}

describe("utils", () => {
  describe("SubscribingEventEmitter", () => {
    test("register/unregister listeners", async () => {
      const worker = new Worker();
      expect(worker.listenerCount("function")).toBe(0);

      worker.addSubscriber(new Subscriber());
      expect(worker.listenerCount("function")).toBe(1);

      worker.removeAllListeners();
      expect(worker.listenerCount("function")).toBe(0);
    });

    test("listerner is called", async () => {
      const worker = new Worker();
      const subscriber = new Subscriber();
      worker.addSubscriber(subscriber);
      worker.emit("function");

      expect(subscriber.events["function"]).toBe(1);
    });
  });
});
