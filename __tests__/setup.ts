import * as dotenv from "dotenv";
dotenv.config();

// Point Prisma at the test database before any client is instantiated
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
