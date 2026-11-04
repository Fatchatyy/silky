import { withIsland } from '../lib/island';
import GuestRoute from '../components/GuestRoute';
import Login from '../screens/Login';

export default withIsland(() => (
  <GuestRoute>
    <Login />
  </GuestRoute>
));
