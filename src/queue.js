export class TaskQueue {
  constructor({ concurrency = 1, maxQueue = 5 } = {}) {
    this.concurrency = concurrency;
    this.maxQueue = maxQueue;
    this.running = 0;
    this.queue = [];
    this.runningJobs = [];
    this.nextJobId = 1;
  }

  getStats() {
    return {
      running: this.running,
      pending: this.queue.length,
      concurrency: this.concurrency,
      maxQueue: this.maxQueue
    };
  }

  getSnapshot() {
    return {
      running: this.running,
      pending: this.queue.length,
      concurrency: this.concurrency,
      maxQueue: this.maxQueue,
      runningItems: this.runningJobs.map((job) => ({
        id: job.id,
        meta: { ...job.meta }
      })),
      pendingItems: this.queue.map((job) => ({
        id: job.id,
        meta: { ...job.meta }
      }))
    };
  }

  submit(taskFn, meta = {}) {
    if (this.queue.length >= this.maxQueue) {
      throw new Error(`대기열이 가득 찼어. 잠시 후 다시 시도해줘. (최대 대기 ${this.maxQueue}개)`);
    }

    const position = this.running + this.queue.length + 1;

    let resolvePromise;
    let rejectPromise;

    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    this.queue.push({
      id: this.nextJobId,
      taskFn,
      meta: { ...meta },
      resolve: resolvePromise,
      reject: rejectPromise
    });
    this.nextJobId += 1;

    this.#drain();

    return { position, promise };
  }

  #drain() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      this.running += 1;
      this.runningJobs.push(job);
      void this.#runJob(job);
    }
  }

  async #runJob(job) {
    try {
      const result = await job.taskFn();
      job.resolve(result);
    } catch (error) {
      job.reject(error);
    } finally {
      this.runningJobs = this.runningJobs.filter((runningJob) => runningJob.id !== job.id);
      this.running -= 1;
      this.#drain();
    }
  }
}
