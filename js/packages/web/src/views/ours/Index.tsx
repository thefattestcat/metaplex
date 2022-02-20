import { useWallet, WalletContextState } from '@solana/wallet-adapter-react';
import {
  mintNewEditionFromMasterEditionViaToken,
  useConnection,
  useConnectionConfig,
} from '@oyster/common';
import { Col, Layout, Row } from 'antd';
import React, { useEffect, useState } from 'react';
import { Connection, Keypair, TransactionInstruction } from '@solana/web3.js';
import { createMintAndAccountWithOne } from '../../actions/createMintAndAccountWithOne';
import { MintLayout } from '@solana/spl-token';
import { mintNFT } from '../../actions';

const { Content } = Layout;

async function getNewMint(
  wallet: WalletContextState,
  connection: Connection,
): Promise<any> {
  const instructions: TransactionInstruction[] = [];
  const signers: Keypair[] = [];
  if (!wallet.publicKey) {
    throw new Error('Wallet pubKey is not provided');
  }

  const mintRentExempt = await connection.getMinimumBalanceForRentExemption(
    MintLayout.span,
  );

  const vmAccount = 'F6ryF1KK3Ehxz6DdxMH4cRZJxJxpHCe9gW5VTKMaKfyb';

  const newMint = await createMintAndAccountWithOne(
    wallet,
    vmAccount,
    mintRentExempt,
    instructions,
    signers,
  );

  return { ...newMint, instructions, signers };
}

export const Index = () => {
  const wallet = useWallet();
  const connection = useConnection();
  const { endpoint } = useConnectionConfig();
  const [files, setFiles] = useState<File[]>([]);
  const [nftCreateProgress, setNFTcreateProgress] = useState<number>(0);

  if (wallet.connected) {
    // console.log(wallet);
    // console.log(connection);
  }

  async function doMint(e) {
    e.preventDefault();
    // const newMint = await getNewMint(wallet, connection);
    // console.log(newMint);

    // const attributes = {
    //   name: 'Page',
    //   symbol: 'DEEZ',
    //   description: 'Deez',
    //   external_url: 'https://solflare.com',
    //   image: 'https://arweave.net/nhjGl6alIKUbS9MmkYRCaf1MjjTtDEGtuSF42gaIW7k',
    //   attributes: [],
    //   seller_fee_basis_points: 0.1,
    //   creators: [
    //     {
    //       address: 'HRgxeoS3ZnCMeYJZ8XLrKfqCXKmAYUgVvsqY74M44FTc',
    //       share: 100,
    //       verified: true,
    //     },
    //   ],
    //   properties: {
    //     files: [],
    //     category: 'category',
    //   },
    //   animation_url: 'test',
    // };

    const attributes = {
      name: 'asdasdasdasd',
      symbol: 'DEEZ',
      description: 'Celebratory Solflare NFT for the Solflare X launch',
      seller_fee_basis_points: 0,
      image: 'https://www.arweave.net/abcd5678?ext=png',
      animation_url: 'https://www.arweave.net/efgh1234?ext=mp4',
      external_url: 'https://solflare.com',
      attributes: [
        {
          trait_type: 'web',
          value: 'yes',
        },
        {
          trait_type: 'mobile',
          value: 'yes',
        },
        {
          trait_type: 'extension',
          value: 'yes',
        },
      ],
      collection: {
        name: 'asdasdasdasd',
        family: 'Solflare',
      },
      properties: {
        files: [
          {
            uri: 'https://www.arweave.net/abcd5678?ext=png',
            type: 'image/png',
          },
          {
            uri: 'https://watch.videodelivery.net/9876jkl',
            type: 'unknown',
            cdn: true,
          },
          {
            uri: 'https://www.arweave.net/efgh1234?ext=mp4',
            type: 'video/mp4',
          },
        ],
        category: 'video',
      },
      creators: [
        {
          address: 'xEtQ9Fpv62qdc1GYfpNReMasVTe9YW5bHJwfVKqo72u',
          share: 100,
        },
      ],
    };

    const metadata = {
      name: attributes.name,
      symbol: attributes.symbol,
      creators: attributes.creators,
      description: attributes.description,
      sellerFeeBasisPoints: attributes.seller_fee_basis_points,
      image: attributes.image,
      animation_url: attributes.animation_url,
      attributes: attributes.attributes,
      external_url: attributes.external_url,
      properties: {
        files: attributes.properties.files,
        category: attributes.properties?.category,
      },
    };

    const nft = await mintNFT(
      connection,
      wallet,
      endpoint.name,
      files,
      metadata,
      setNFTcreateProgress,
      1,
    );

    console.log('NFT', nft);
  }

  useEffect(() => {
    console.log(nftCreateProgress);
  });

  return (
    <Content style={{ display: 'flex', flexWrap: 'wrap' }}>
      <Col style={{ width: '100%', marginTop: 32 }}>
        <Row>
          <div>
            <h1 style={{ color: 'white' }}>TEST</h1>
            <h2>{nftCreateProgress}</h2>
            <button onClick={doMint}>Mint</button>
          </div>
        </Row>
      </Col>
    </Content>
  );
};
