/** What the workers case sends. */
interface Question {
  n: number;
}

/** What this worker answers. */
interface Answer {
  doubled: number;
}

// The worker's own global, declared here because this fixture is type-checked
// against the DOM library, where `self` is a window.
declare const self: {
  addEventListener(
    type: "message",
    handler: (event: MessageEvent<Question>) => void,
  ): void;
  postMessage(message: Answer): void;
};

self.addEventListener("message", (event) => {
  self.postMessage({ doubled: event.data.n * 2 });
});

export {};
