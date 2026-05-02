import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

url = 'postgresql+asyncpg://exchange_user:exchange_pass@localhost:5432/exchange_sim'
engine = create_async_engine(url)

async def run():
    async with engine.begin() as conn:
        with open('c:/Shreyas/Web/india-exchange-sim/apps/engine/db/init.sql', 'r', encoding='utf-8') as f:
            sql = f.read()
            # Split sql into individual statements because asyncpg doesn't support executing multiple statements via text() easily
            # actually we can just use asyncpg directly or execute text() if it supports it
            
            # Since init.sql has multiple statements separated by ;, let's try raw connection
            raw_conn = await conn.get_raw_connection()
            await raw_conn.driver_connection.execute(sql)
            
    print('Seeded successfully!')

asyncio.run(run())
