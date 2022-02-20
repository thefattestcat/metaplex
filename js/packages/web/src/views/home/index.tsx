import { Layout } from 'antd';
import React from 'react';
import { Index } from '../ours/Index';

export const HomeView = () => {
  return (
    <Layout style={{ margin: 0, marginTop: 30, alignItems: 'center' }}>
      <Index />
    </Layout>
  );
};
