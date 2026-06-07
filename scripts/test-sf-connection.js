const jsforce = require('jsforce');

const conn = new jsforce.Connection({
  loginUrl: 'https://test.salesforce.com'
});

const username = 't-akumar9@supplier.pldt.com.ph.tfxnfdev01';
const password = '@Ironman8TOfW6Gg14KKs3Olq1jSemlsGD';

async function run() {
  try {
    await conn.login(username, password);
    console.log('Connected');

    //const result = await conn.tooling.query(
    //  "SELECT Name, LastModifiedDate FROM ApexClass"
    //);
    const accResult = await conn.query(
        "SELECT Name FROM Account LIMIT 5"
      );
      
      console.log("\nAccounts:");
      accResult.records.forEach(a => {
        console.log(a.Name);
      });

    accResult.records.forEach(r => {
      console.log(r.Name, r.LastModifiedDate);
    });

  } catch (err) {
    console.error('ERROR:', err);
  }
}

run();