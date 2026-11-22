import mongoose from 'mongoose';

const run = async () => {
  await mongoose.connect('mongodb+srv://baapoomartsales_db_user:LkyDwaVkmkMZlR3W@cluster0.hmbpno5.mongodb.net/baapoomart?retryWrites=true&w=majority');
  const db = mongoose.connection.db;

  const vendor = await db.collection('vendors').findOne({ email: 'sekar@gmail.com' });
  console.log('Vendor:', vendor?.storeName, vendor?.status, vendor?._id);

  if (vendor) {
    const address = await db.collection('vendoraddresses').findOne({ vendorId: vendor._id });
    console.log('Vendor Address:', address);
    if (address) {
      const state = await db.collection('territories').findOne({ _id: address.state });
      const district = await db.collection('territories').findOne({ _id: address.district });
      const taluk = await db.collection('territories').findOne({ _id: address.talukArea });
      console.log('Resolved Territory -> State:', state?.name, 'District:', district?.name, 'Taluk/Town:', taluk?.name);
    }
  }

  process.exit(0);
};

run().catch(console.error);
