export interface Job {
  plugins: Array<any> | null;
  pluginOptions: {
    [key: string]: {
      [key: string]: any;
    };
  };
  perform: Function;
}
