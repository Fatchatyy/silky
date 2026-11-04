import { withIsland } from '../lib/island';
import CustomerRoute from '../components/CustomerRoute';
import Account from '../screens/Account';

export default withIsland(() => (
  <CustomerRoute>
    <Account />
  </CustomerRoute>
));
