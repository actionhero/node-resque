export interface Job<TResult> {
  plugins: Array<any>;
  pluginOptions: {
    [pluginName: string]: {
      [key: string]: any;
    };
  };
  perform: (...args: any[]) => Promise<TResult>;
}

export interface JobEmit {
  queue?: string;
  class?: string;
  args?: Array<any>;
}
