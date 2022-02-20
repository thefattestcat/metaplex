import {
  createAssociatedTokenAccountInstruction,
  createMetadataInstruction,
  createMasterEditionInstruction,

  ////  createUpdateMetadataInstruction,
} from './helpers/instructions';

import { sendTransactionWithRetryWithKeypair } from './helpers/transactions';

import {
  getTokenWallet,
  getMetadata,
  getMasterEdition,
} from './helpers/accounts';

const { Wallet, web3, BN } = require('@project-serum/anchor');

import {
  Data,
  Creator,
  CreateMetadataArgs,
  ////UpdateMetadataArgs,
  CreateMasterEditionArgs,
  METADATA_SCHEMA,
} from './helpers/schema';

import { serialize } from 'borsh';

import { TOKEN_PROGRAM_ID } from './helpers/constants';

import fetch from 'node-fetch';

import { MintLayout, Token } from '@solana/spl-token';

import {
  Keypair,
  Connection,
  SystemProgram,
  TransactionInstruction,
  PublicKey,
} from '@solana/web3.js';

import { programIds } from './helpers/programIds';

//============================================================================
//createMetadata()
//============================================================================
export const createMetadata = async metadataLink => {
  console.log('createMetadata() called');
  console.log(metadataLink);
  // Metadata
  const data = await fetch(metadataLink, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })
    .then(response => response.json())
    .then(metadata => {
      console.log(metadata);
      // Validate metadata
      if (
        !metadata.name ||
        !metadata.image ||
        isNaN(metadata.seller_fee_basis_points) ||
        !metadata.properties ||
        !Array.isArray(metadata.properties.creators)
      ) {
        console.log(
          'invalid metadata',
          metadata.name,
          metadata.image,
          isNaN(metadata.seller_fee_basis_points),
          metadata.properties,
          Array.isArray(metadata.properties.creators),
        );
        return;
      }

      // Validate creators
      const metaCreators = metadata.properties.creators;
      if (
        metaCreators.some(creator => !creator.address) ||
        metaCreators.reduce((sum, creator) => creator.share + sum, 0) !== 100
      ) {
        return;
      }

      const creators = metaCreators.map(
        creator =>
          new Creator({
            address: creator.address,
            share: creator.share,
            verified: 1,
          }),
      );

      console.log('metadata created successfully');
      return new Data({
        symbol: metadata.symbol,
        name: metadata.name,
        uri: metadataLink,
        sellerFeeBasisPoints: metadata.seller_fee_basis_points,
        creators: creators,
      });
    });
  return data;
};

//============================================================================
//mintNFT()
//============================================================================

export const mintNFT = async (
  connection,
  wallet,
  endpoint,
  metadataLink,
  progressCallback,
  maxSupply,
) => {
  console.log(wallet);
  if (!wallet?.publicKey) return;
  console.log('test');
  const metadata = await createMetadata(metadataLink);
  console.log('metadata', metadata);
  const metadataContent = {
    name: metadata.name,
    symbol: metadata.symbol,
    description: metadata.description,
    seller_fee_basis_points: metadata.sellerFeeBasisPoints,
    image: metadata.image,
    animation_url: metadata.animation_url,
    attributes: metadata.attributes,
    external_url: metadata.external_url,
    properties: {
      ...metadata.properties,
      creators: metadata.creators?.map(creator => {
        return {
          address: creator.address,
          share: creator.share,
        };
      }),
    },
  };
  console.log(metadataContent);
  const RESERVED_METADATA = {};
  const realFiles = [
    new File([JSON.stringify(metadataContent)], RESERVED_METADATA),
  ];

  const { instructions: pushInstructions, signers: pushSigners } =
    await prepPayForFilesTxn(wallet, realFiles, metadata);

  progressCallback(1);

  const TOKEN_PROGRAM_ID = programIds().token;

  // Allocate memory for the account
  const mintRent = await connection.getMinimumBalanceForRentExemption(
    MintLayout.span,
  );
  // const accountRent = await connection.getMinimumBalanceForRentExemption(
  //   AccountLayout.span,
  // );

  // This owner is a temporary signer and owner of metadata we use to circumvent requesting signing
  // twice post Arweave. We store in an account (payer) and use it post-Arweave to update MD with new link
  // then give control back to the user.
  // const payer = new Account();
  const payerPublicKey = wallet.publicKey.toBase58();
  const instructions = [...pushInstructions];
  const signers = [...pushSigners];

  // This is only temporarily owned by wallet...transferred to program by createMasterEdition below
  const mintKey = createMint(
    instructions,
    wallet.publicKey,
    mintRent,
    0,
    // Some weird bug with phantom where it's public key doesnt mesh with data encode wellff
    toPublicKey(payerPublicKey),
    toPublicKey(payerPublicKey),
    signers,
  ).toBase58();

  const recipientKey = (
    await findProgramAddress(
      [
        wallet.publicKey.toBuffer(),
        programIds().token.toBuffer(),
        toPublicKey(mintKey).toBuffer(),
      ],
      programIds().associatedToken,
    )
  )[0];

  createAssociatedTokenAccountInstruction(
    instructions,
    toPublicKey(recipientKey),
    wallet.publicKey,
    wallet.publicKey,
    toPublicKey(mintKey),
  );

  const metadataAccount = await createMetadata(
    new Data({
      symbol: metadata.symbol,
      name: metadata.name,
      uri: ' '.repeat(64), // size of url for arweave
      sellerFeeBasisPoints: metadata.sellerFeeBasisPoints,
      creators: metadata.creators,
    }),
    payerPublicKey,
    mintKey,
    payerPublicKey,
    instructions,
    wallet.publicKey.toBase58(),
  );
  progressCallback(2);

  // TODO: enable when using payer account to avoid 2nd popup
  // const block = await connection.getRecentBlockhash('singleGossip');
  // instructions.push(
  //   SystemProgram.transfer({
  //     fromPubkey: wallet.publicKey,
  //     toPubkey: payerPublicKey,
  //     lamports: 0.5 * LAMPORTS_PER_SOL // block.feeCalculator.lamportsPerSignature * 3 + mintRent, // TODO
  //   }),
  // );

  const { txid } = await sendTransactionWithRetry(
    connection,
    wallet,
    instructions,
    signers,
    'single',
  );
  progressCallback(3);

  try {
    await connection.confirmTransaction(txid, 'max');
    progressCallback(4);
  } catch {
    // ignore
  }

  // Force wait for max confirmations
  // await connection.confirmTransaction(txid, 'max');
  await connection.getParsedConfirmedTransaction(txid, 'confirmed');

  progressCallback(5);

  // this means we're done getting AR txn setup. Ship it off to ARWeave!
  const data = new FormData();
  metadata.append('transaction', txid);
  metadata.append('env', endpoint);

  const tags = realFiles.reduce((acc, f) => {
    acc[f.name] = [{ name: 'mint', value: mintKey }];
    return acc;
  }, {});
  metadata.append('tags', JSON.stringify(tags));
  realFiles.map(f => metadata.append('file[]', f));

  // TODO: convert to absolute file name for image

  const result = await uploadToArweave(metadata);
  progressCallback(6);

  const metadataFile = result.messages?.find(
    m => m.filename === RESERVED_TXN_MANIFEST,
  );
  if (metadataFile?.transactionId && wallet.publicKey) {
    const updateInstructions = [];
    const updateSigners = [];

    // TODO: connect to testnet arweave
    const arweaveLink = `https://arweave.net/${metadataFile.transactionId}`;
    await updateMetadata(
      new Data({
        name: metadata.name,
        symbol: metadata.symbol,
        uri: arweaveLink,
        creators: metadata.creators,
        sellerFeeBasisPoints: metadata.sellerFeeBasisPoints,
      }),
      undefined,
      undefined,
      mintKey,
      payerPublicKey,
      updateInstructions,
      metadataAccount,
    );

    updateInstructions.push(
      Token.createMintToInstruction(
        TOKEN_PROGRAM_ID,
        toPublicKey(mintKey),
        toPublicKey(recipientKey),
        toPublicKey(payerPublicKey),
        [],
        1,
      ),
    );

    progressCallback(7);
    // // In this instruction, mint authority will be removed from the main mint, while
    // // minting authority will be maintained for the Printing mint (which we want.)
    await createMasterEdition(
      maxSupply !== undefined ? new BN(maxSupply) : undefined,
      mintKey,
      payerPublicKey,
      payerPublicKey,
      payerPublicKey,
      updateInstructions,
    );

    // TODO: enable when using payer account to avoid 2nd popup
    /*  if (maxSupply !== undefined)
        updateInstructions.push(
          setAuthority({
            target: authTokenAccount,
            currentAuthority: payerPublicKey,
            newAuthority: wallet.publicKey,
            authorityType: 'AccountOwner',
          }),
        );
  */
    // TODO: enable when using payer account to avoid 2nd popup
    // Note with refactoring this needs to switch to the updateMetadataAccount command
    // await transferUpdateAuthority(
    //   metadataAccount,
    //   payerPublicKey,
    //   wallet.publicKey,
    //   updateInstructions,
    // );

    progressCallback(8);

    const txid = await sendTransactionWithRetry(
      connection,
      wallet,
      updateInstructions,
      updateSigners,
    );

    notify({
      message: 'Art created on Solana',
      description: (
        <a href={arweaveLink} target="_blank" rel="noopener noreferrer">
          Arweave Link
        </a>
      ),
      type: 'success',
    });

    // TODO: refund funds

    // send transfer back to user
  }
  // TODO:
  // 1. Jordan: --- upload file and metadata to storage API
  // 2. pay for storage by hashing files and attaching memo for each file
  console.log(metadataAccount.toString());
  return { metadataAccount };
};

export const prepPayForFilesTxn = async (wallet, files, metadata) => {
  const memo = programIds().memo;

  const instructions = [];
  const signers = [];

  if (wallet.publicKey)
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: AR_SOL_HOLDER_ID,
        lamports: await getAssetCostToStore(files),
      }),
    );

  for (let i = 0; i < files.length; i++) {
    const hashSum = crypto.createHash('sha256');
    hashSum.update(await files[i].text());
    const hex = hashSum.digest('hex');
    instructions.push(
      new TransactionInstruction({
        keys: [],
        programId: memo,
        data: Buffer.from(hex),
      }),
    );
  }

  return {
    instructions,
    signers,
  };
};

export const mintNFT2 = async (
  connection,
  walletKeypair,
  metadataLink,
  mutableMetadata,
) => {
  console.log('mintNFT2() called');
  // Retrieve metadata
  const data = await createMetadata(metadataLink);
  console.log('metadata: ', data.toString());
  if (!data) return;

  // Create wallet from keypair
  console.log(Wallet);
  const wallet = walletKeypair.wallet.adapter;
  if (!wallet.publicKey) return;

  console.log(wallet);

  // Allocate memory for the account
  const mintRent = await new Connection(
    'http://localhost:8899',
  ).getMinimumBalanceForRentExemption(MintLayout.span);

  // Generate a mint
  const mint = web3.Keypair.generate();
  const instructions = [];
  const signers = [mint, walletKeypair];

  instructions.push(
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: mintRent,
      space: MintLayout.span,
      programId: TOKEN_PROGRAM_ID,
    }),
  );
  instructions.push(
    Token.createInitMintInstruction(
      TOKEN_PROGRAM_ID,
      mint.publicKey,
      0,
      wallet.publicKey,
      wallet.publicKey,
    ),
  );

  const userTokenAccoutAddress = await getTokenWallet(
    wallet.publicKey,
    mint.publicKey,
  );
  instructions.push(
    createAssociatedTokenAccountInstruction(
      userTokenAccoutAddress,
      wallet.publicKey,
      wallet.publicKey,
      mint.publicKey,
    ),
  );

  // Create metadata
  const metadataAccount = await getMetadata(mint.publicKey);
  let txnData;

  instructions.push(
    createMetadataInstruction(
      metadataAccount,
      mint.publicKey,
      wallet.publicKey,
      wallet.publicKey,
      wallet.publicKey,
      txnData,
    ),
  );

  instructions.push(
    Token.createMintToInstruction(
      TOKEN_PROGRAM_ID,
      mint.publicKey,
      userTokenAccoutAddress,
      wallet.publicKey,
      [],
      1,
    ),
  );

  // Create master edition
  const editionAccount = await getMasterEdition(mint.publicKey);
  txnData = Buffer.from(
    serialize(
      METADATA_SCHEMA,
      new CreateMasterEditionArgs({ maxSupply: new BN(0) }),
    ),
  );

  instructions.push(
    createMasterEditionInstruction(
      metadataAccount,
      editionAccount,
      mint.publicKey,
      wallet.publicKey,
      wallet.publicKey,
      wallet.publicKey,
      txnData,
    ),
  );

  const res = await sendTransactionWithRetryWithKeypair(
    connection,
    walletKeypair,
    instructions,
    signers,
  );

  try {
    await connection.confirmTransaction(res.txid, 'max');
  } catch {
    // ignore
  }

  // Force wait for max confirmations
  await connection.getParsedConfirmedTransaction(res.txid, 'confirmed');
  console.log(metadataAccount.toString());
  return metadataAccount;
};
