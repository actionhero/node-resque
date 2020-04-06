import { SubscribingEventEmitter } from "../../src/utils/SubscribingEventEmitter";

class Worker extends SubscribingEventEmitter {}

class Subscriber {
  /**
   * counter for invocations
   */
  public events = {
    function: 0,
    start: 0,
    static: 0,
  };

  public static staticEvents = {
    static: 0,
  };

  onstart() {
    // this this will throw if "this" is not resolved to current class
    this.events["start"]++;
  }

  static staticMethod() {
    Subscriber.staticEvents["static"]++;
  }

  getSubscribedEvents() {
    return {
      // inline callback
      function: () => this.events["function"]++,
      // pointer to class method
      start: this.onstart,
      // using static method
      static: Subscriber.staticMethod,
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
      worker.emit("start");
      worker.emit("function");
      worker.emit("static");

      expect(subscriber.events["start"]).toBe(1);
      expect(subscriber.events["function"]).toBe(1);
      expect(Subscriber.staticEvents["static"]).toBe(1);
    });
  });
});
