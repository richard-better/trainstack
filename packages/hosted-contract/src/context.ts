export type Session = {
  user: {
    id: string;
    name: string;
    email: string;
  };
};

export type Context = {
  session: Session | null;
};
